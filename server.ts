import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import { buildClarifications } from "./src/lib/clarifications";
import { generateItinerary, type PlanningRequest } from "./server/agent";
import { searchPlaces, parseLngLat } from "./server/tools/amap";

function proxyAmapImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/(?:^|\.)(autonavi|amap)\.com/.test(url)) {
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/')) {
      console.log(`[api] ${req.method} ${req.url}`);
    }
    next();
  });

  const deepseek = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });

  app.post("/api/clarify-input", (req, res) => {
    try {
      const { input } = req.body;
      if (!input) {
        return res.status(400).json({ error: "input is required" });
      }
      const questions = buildClarifications(input);
      res.json({ questions });
    } catch (error: any) {
      console.error("Error building clarifications:", error);
      res.status(500).json({ error: "Failed to build clarifications" });
    }
  });

  // Image proxy — Amap POI photos lack CORS headers, so html-to-image
  // can't inline them when exporting. Route them through this endpoint.
  app.get("/api/image-proxy", async (req, res) => {
    try {
      let target = String(req.query.url ?? '');
      if (!target) return res.status(400).send('missing url');
      // html-to-image's cache-bust appends `&<ts>` directly to the request URL,
      // which contaminates the encoded `url` query param. Strip trailing
      // `&<digits>` if present.
      target = target.replace(/&\d+$/, '');
      // The agent's LLM occasionally double-encodes URLs when copying tool output
      // back into its JSON. Decode until we hit a real http(s) URL.
      while (/^https?%3A/i.test(target)) {
        try {
          target = decodeURIComponent(target);
        } catch {
          break;
        }
      }
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        return res.status(400).send('invalid url');
      }
      if (!/(?:^|\.)(autonavi|amap)\.com$/.test(u.host)) {
        return res.status(400).send('host not allowed');
      }
      const upstream = await fetch(target);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (!upstream.ok) {
        // LLM occasionally fabricates non-existent image URLs. Return a
        // transparent placeholder so html-to-image can keep going.
        const transparent = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
          'base64',
        );
        res.setHeader('Content-Type', 'image/png');
        return res.send(transparent);
      }
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (error: any) {
      console.error('Image proxy error:', error);
      res.status(500).send('proxy error');
    }
  });

  app.get("/api/search-places", async (req, res) => {
    try {
      const keywords = String(req.query.q || '').trim();
      const region = req.query.region ? String(req.query.region) : undefined;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '10'), 10) || 10, 1), 20);
      if (!keywords) return res.json({ results: [] });
      const r = await searchPlaces(keywords, region, limit);
      const results = r.pois
        .map(p => {
          const c = parseLngLat(p.location);
          if (!c) return null;
          return {
            id: p.id,
            name: p.name,
            address: p.address,
            lat: c.lat,
            lng: c.lng,
            type: p.type,
            rating: p.rating,
            photoUrl: proxyAmapImageUrl(p.photoUrl),
          };
        })
        .filter(Boolean);
      res.json({ results });
    } catch (error: any) {
      console.error('Error searching places:', error);
      res.status(500).json({ error: 'Failed to search places' });
    }
  });

  app.post("/api/generate-itinerary", async (req, res) => {
    try {
      const { destination, days, people, preferences, groupType, budget, specialNeeds, startDate, endDate, clarifications } = req.body as PlanningRequest;

      if (!destination || !days) {
        return res.status(400).json({ error: "Destination and days are required." });
      }

      const itinerary = await generateItinerary(
        {
          destination,
          days,
          people: people ?? 1,
          preferences: preferences ?? [],
          groupType,
          budget,
          specialNeeds,
          startDate,
          endDate,
          clarifications,
        },
        { client: deepseek },
      );

      // Debug: count valid coordinates
      try {
        const it = itinerary as any;
        let total = 0;
        let valid = 0;
        const sample: any[] = [];
        for (const day of it.days ?? []) {
          for (const slot of day.slots ?? []) {
            for (const p of slot.places ?? []) {
              total++;
              const lat = Number(p?.coordinates?.lat);
              const lng = Number(p?.coordinates?.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) valid++;
              if (sample.length < 3) sample.push({ name: p?.name, coords: p?.coordinates });
            }
          }
        }
        console.log(`[agent] places: ${valid}/${total} have valid coords`);
        console.log('[agent] sample coords:', JSON.stringify(sample));
      } catch {}

      res.json(itinerary);
    } catch (error: any) {
      console.error("Error generating itinerary:", error);
      res.status(500).json({ error: "Failed to generate itinerary. Please try again." });
    }
  });

  app.post("/api/verify-itinerary", async (req, res) => {
    try {
      const { itinerary } = req.body;
      const prompt = `You are an AI travel assistant. Analyze the given itinerary and find issues:
1. Too rushed (not enough time between places).
2. Geographically illogical (places jumping back and forth across a city).
3. Awkward meal times.

Respond with a JSON object of shape: { "issues": [ { "severity": "low" | "medium" | "high", "message": string, "suggestion": string } ] }
If perfect, return { "issues": [] }.

Itinerary:
${JSON.stringify(itinerary)}`;

      const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a travel critic. Respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const text = response.choices[0]?.message?.content || '{"issues":[]}';
      const parsed = JSON.parse(text);
      res.json(parsed.issues || []);
    } catch (error: any) {
      console.error("Error verifying:", error);
      res.status(500).json({ error: "Failed to verify" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Wayfound server running on http://localhost:${PORT}`);
  });
}

startServer();
