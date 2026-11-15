import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import { createDeepSeekClient } from "./server/llm";
import { buildClarifications } from "./src/lib/clarifications";
import { generateItinerary, type PlanningRequest, type ToolCallRecord, type AgentStepRecord } from "./server/agent";
import { searchPlaces, parseLngLat } from "./server/tools/amap";
import { computeSourceAttributions, computeGroundingWarning } from "./server/tools/attributions";
import { getLiveLibrary, lessonsForRequest } from "./server/experience/live";
import { ungroundedPlaceNames } from "./server/grounding";
import { extractPreferences } from "./server/preferences";
import { structureItinerary } from "./server/structure";
import type { Poi } from "./server/tools/provider";
import { parseEdit } from "./server/editParse";
import { replanItinerary, type ReplanRequest } from "./server/replan";
import { identifyPhoto, PhotoInputError } from "./server/photo";

// Persistent per-request trace files for the debug TraceViewer
// (src/components/TraceViewer.tsx) — one JSON file per generation request,
// written unconditionally (no env gate; reading them back is what's
// gated — see the GET /api/trace/:requestId route below and the
// frontend's debug-only entry point). No retention/cleanup policy: this
// is a debug aid, not a production logging pipeline — files accumulate
// under server/logs/traces/ until something else cleans them up.
const TRACE_DIR = path.join(process.cwd(), "server", "logs", "traces");
const REQUEST_ID_PATTERN = /^[a-f0-9-]{36}$/; // matches crypto.randomUUID()'s format — also the sanitization boundary for the :requestId route param below

function writeTraceFile(requestId: string, payload: Record<string, unknown>) {
  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(TRACE_DIR, `${requestId}.json`), JSON.stringify(payload, null, 2));
  } catch (err) {
    // Trace persistence is a debug aid, not a hard dependency — never let
    // a filesystem hiccup here affect the actual itinerary response.
    console.error("[trace] failed to write trace file:", err);
  }
}

// Same flag as server/agent.ts's recovery-layer gating (see its "5-layer
// error-recovery pipeline" comment) — this is layer 5, the route-level
// try/catch below. Not exercised by `npm run eval` (which calls
// generateItinerary() directly), only relevant when hitting this route.
const RECOVERY_DISABLED = process.env.DISABLE_ERROR_RECOVERY === 'true';

function proxyAmapImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/(?:^|\.)(autonavi|amap)\.com/.test(url)) {
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(express.json({ limit: '1mb' }));

  // Allow requests from Cloudflare Pages and local dev
  app.use((req, res, next) => {
    const allowed = [
      'https://wayfound-ezv.pages.dev',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    const origin = req.headers.origin || '';
    if (allowed.includes(origin) || origin.endsWith('.pages.dev')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/')) {
      console.log(`[api] ${req.method} ${req.url}`);
    }
    next();
  });

  const deepseek = createDeepSeekClient();

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
      const upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
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
    const requestId = randomUUID();
    const startedAt = Date.now();
    // Populated so we can tell whether get_destination_context (Wikivoyage,
    // CC BY-SA 4.0) / search_places-via-OSM actually contributed to this
    // itinerary — needed for honest, non-blanket UI attribution below.
    const trace: ToolCallRecord[] = [];
    // Full reasoning-step -> tool-call -> result -> next-step trace, for
    // the persistent per-request debug log + TraceViewer. Independent of
    // `trace` above (see AgentStepRecord's docstring in server/agent.ts).
    const stepTrace: AgentStepRecord[] = [];
    // Every POI the tools returned, for poiId attachment (server/structure.ts).
    const pois: Poi[] = [];
    let destinationForTrace = '';

    try {
      const { destination, days, people, preferences, groupType, budget, specialNeeds, startDate, endDate, clarifications, memoryContext, language, useLibrary } = req.body as PlanningRequest & { useLibrary?: unknown };
      destinationForTrace = destination ?? '';

      if (!destination || !days) {
        return res.status(400).json({ error: "Destination and days are required." });
      }

      // Experience library (v2 Core 2): on unless the request says
      // `useLibrary: false`. Off, the prompt is byte-identical to a plan
      // without a library.
      const lessons = lessonsForRequest(useLibrary, destination);

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
          memoryContext,
          // Only 'en' / 'zh' reach the prompt; anything else is dropped.
          language: language === 'en' || language === 'zh' ? language : undefined,
        },
        { client: deepseek, trace, stepTrace, lessons, pois },
      );

      // Shared with tests/eval/run-eval.ts so the eval harness's
      // scoreDestinationContextUsage checks the same attribution logic
      // production actually runs, not a hand-copied approximation of it.
      const sourceAttributions = computeSourceAttributions(trace, destination);
      // Honesty disclaimer for the UI — true when search_places mostly/
      // entirely failed to find anything real this run, meaning a
      // meaningful share of these places likely came from the model's
      // general knowledge rather than a verified search hit. See
      // computeGroundingWarning's docstring; rendered in ItineraryPane.tsx.
      const groundingWarning = computeGroundingWarning(trace);
      // Places that matched no search_places result this run, by the same
      // rule as the eval's hallucination score (server/grounding.ts).
      const ungrounded = ungroundedPlaceNames(trace, itinerary as any);

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

      writeTraceFile(requestId, {
        requestId,
        destination: destinationForTrace,
        createdAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        error: null,
        steps: stepTrace,
      });

      // v2 structured state: slot ids, estimated times and travel, version
      // (server/structure.ts). Outside the agent, so eval output is unchanged.
      const structured = structureItinerary(itinerary as any, pois);

      res.json({
        ...(structured as object),
        ...(sourceAttributions.length > 0 ? { sourceAttributions } : {}),
        ...(groundingWarning ? { groundingWarning } : {}),
        usedLessonIds: lessons?.ids ?? [],
        ...(lessons ? { libraryVersion: lessons.libraryVersion } : {}),
        ungroundedPlaceNames: ungrounded,
        requestId,
      });
    } catch (error: any) {
      console.error("Error generating itinerary:", error);
      writeTraceFile(requestId, {
        requestId,
        destination: destinationForTrace,
        createdAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        error: error.message ?? String(error),
        steps: stepTrace,
      });
      // Recovery layer 5: still always respond (never leave an Express 4
      // async handler's rejection unhandled — that hangs the request
      // rather than usefully demonstrating "no recovery"). What toggles is
      // whether the client sees a friendly message or the raw error.
      if (RECOVERY_DISABLED) {
        res.status(500).json({ error: error.message ?? String(error) });
      } else {
        res.status(500).json({ error: "Failed to generate itinerary. Please try again." });
      }
    }
  });

  // Partial replanning (v2 feature C), step 1: what does the user want to change?
  app.post("/api/parse-edit", async (req, res) => {
    try {
      const { itinerary, message, language, activeDay } = req.body as { itinerary?: any; message?: unknown; language?: unknown; activeDay?: unknown };
      if (!itinerary?.days || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "itinerary and message are required." });
      }
      const plan = await parseEdit(deepseek, itinerary, message.slice(0, 1000), language === "zh" ? "zh" : "en", Number(activeDay) || undefined);
      res.json({ plan });
    } catch (error: any) {
      console.error("Error parsing edit:", error);
      res.status(500).json({ error: "Failed to understand the edit." });
    }
  });

  // Partial replanning, step 2: replan only the target slots and validate
  // (server/replan.ts + replanValidate.ts). The user's avoid list comes from
  // their own memory in the browser; the experience library is not used here.
  app.post("/api/replan", async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const trace: ToolCallRecord[] = [];
    const stepTrace: AgentStepRecord[] = [];
    try {
      const body = req.body as Partial<ReplanRequest> & { language?: unknown };
      if (!body.itinerary?.days || !body.plan?.targetSlots) {
        return res.status(400).json({ error: "itinerary and plan are required." });
      }
      const result = await replanItinerary(
        {
          itinerary: body.itinerary,
          plan: body.plan,
          language: body.language === "zh" ? "zh" : "en",
          avoid: Array.isArray(body.avoid) ? body.avoid.filter((a): a is string => typeof a === "string").slice(0, 20) : [],
          budgetCap: typeof body.budgetCap === "number" ? body.budgetCap : undefined,
          people: typeof body.people === "number" ? body.people : undefined,
          preferences: Array.isArray(body.preferences) ? body.preferences : undefined,
          specialNeeds: Array.isArray(body.specialNeeds) ? body.specialNeeds : undefined,
        },
        { client: deepseek, trace, stepTrace },
      );
      writeTraceFile(requestId, {
        requestId,
        destination: body.itinerary.destination ?? "",
        createdAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        error: 'reason' in result ? result.reason : null,
        steps: stepTrace,
      });
      res.json({ ...result, requestId });
    } catch (error: any) {
      console.error("Error replanning:", error);
      res.status(500).json({ error: "Failed to replan." });
    }
  });

  // Photo / screenshot input (v2 feature D). The body carries one downscaled
  // JPEG data URL, so this route alone gets a larger JSON limit. The image
  // is checked by its bytes, stripped of metadata, shown to the vision
  // model, and the name is verified with search_places; only search results
  // come back as candidates. Nothing is written to disk.
  app.post("/api/identify-photo", express.json({ limit: "9mb" }), async (req, res) => {
    try {
      const { image, destination, language } = req.body as { image?: unknown; destination?: unknown; language?: unknown };
      if (typeof image !== "string" || typeof destination !== "string" || !destination.trim()) {
        return res.status(400).json({ error: "image and destination are required." });
      }
      const result = await identifyPhoto(deepseek, image, destination.trim(), language === "zh" ? "zh" : "en");
      res.json(result);
    } catch (error: any) {
      if (error instanceof PhotoInputError) return res.status(400).json({ error: error.message, code: error.code });
      console.error("Error identifying photo:", error);
      res.status(500).json({ error: "Failed to identify the photo." });
    }
  });

  // Re-pack slot ids, estimated times and travel after a client-side edit
  // (adding a verified photo candidate). Pure; see server/structure.ts.
  app.post("/api/restructure", (req, res) => {
    const { itinerary } = req.body as { itinerary?: any };
    if (!itinerary?.days) return res.status(400).json({ error: "itinerary is required." });
    const structured = structureItinerary(itinerary);
    structured.version = (Number(itinerary.version) || 1) + 1;
    res.json(structured);
  });

  // Preference extraction (v2 feature A): the free text a user typed in a
  // session -> structured memory fields, each backed by a verbatim quote
  // (server/preferences.ts). The result goes to the user's own memory
  // (browser, or the account row when signed in), never to the experience library.
  app.post("/api/extract-preferences", async (req, res) => {
    try {
      const { texts, language } = req.body as { texts?: unknown; language?: unknown };
      const clean = Array.isArray(texts) ? texts.filter((t): t is string => typeof t === "string").map(t => t.slice(0, 1000)).slice(0, 20) : [];
      if (clean.length === 0) return res.json({ preferences: {}, items: [], dropped: 0 });
      const result = await extractPreferences(deepseek, clean, language === "zh" ? "zh" : "en");
      res.json(result);
    } catch (error: any) {
      console.error("Error extracting preferences:", error);
      res.status(500).json({ error: "Failed to extract preferences." });
    }
  });

  // The experience library, read-only (v2 Core 2). Only the offline
  // learning loop writes it; the Lessons panel and compare page read it.
  app.get("/api/lessons", (_req, res) => {
    try {
      const lib = getLiveLibrary();
      res.json({
        libraryVersion: lib.libraryVersion,
        method: lib.method,
        epoch: lib.epoch,
        updatedAt: lib.updatedAt,
        lessons: lib.lessons,
      });
    } catch (error: any) {
      console.error("Error reading the experience library:", error);
      res.status(500).json({ error: "Failed to read the experience library." });
    }
  });

  // Debug trace viewer's data source (see src/components/TraceViewer.tsx).
  // Unauthenticated but keyed by an unguessable UUID — reasonable for a
  // demo project's debug aid, not something to rely on for anything
  // actually sensitive. REQUEST_ID_PATTERN both validates the param and
  // doubles as the path-traversal guard before touching the filesystem.
  app.get("/api/trace/:requestId", (req, res) => {
    const { requestId } = req.params;
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return res.status(400).json({ error: "Invalid request id." });
    }
    const filePath = path.join(TRACE_DIR, `${requestId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "No trace found for this request id." });
    }
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      res.type("application/json").send(content);
    } catch (error: any) {
      console.error("[trace] failed to read trace file:", error);
      res.status(500).json({ error: "Failed to read trace." });
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
