# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo. Background docs: [README.md](./README.md) (setup), [travel-agent-PRD.md](./travel-agent-PRD.md) (product spec), [SPEC.md](./SPEC.md) (sprint breakdown + acceptance criteria). This file reflects what's actually implemented, which is behind both docs in places — see Known Gaps.

## What this is

Wayfound is an AI trip-planning tool: a form collects trip params, a DeepSeek tool-use agent generates a structured `Itinerary` (Day → TimeSlot → Place), and the user then edits it on a map + list dual-pane view.

## Architecture

### ReAct loop (`server/agent.ts` → `generateItinerary`)

A manual OpenAI-SDK chat-completions loop against DeepSeek (`deepseek-chat`, OpenAI-compatible), capped at `maxSteps` (default 8):

1. Send system prompt + user prompt (trip params) with `tools` attached, `tool_choice: 'auto'`.
2. If the model returns tool calls, execute each via `runTool` and push `role: 'tool'` results back onto the message list; loop.
3. If the model returns a plain text message instead, treat it as the final answer and `JSON.parse` it (after stripping ```` ``` ```` fences).
4. If the step cap is hit, force one more completion with `response_format: json_object` and no tools, instructing the model to stop calling tools and emit the final itinerary now.

There's no explicit "Thought" field — reasoning is implicit in DeepSeek's tool-call choices; this is closer to a bare function-calling loop than a prompted ReAct transcript.

### Tool layer (`server/tools/`)

- `index.ts` — tool registry: OpenAI-style `toolDefinitions` (schemas sent to the model) + `runTool` dispatcher + `ToolContext`, an in-process `Map<poiId, Poi>` that lets `get_poi_details`/`calculate_distance` resolve POIs by id without re-searching.
- `provider.ts` — shared `Poi`/`PoiSearchResult`/`DistanceResult` types + `getMapProvider(destination)`, the mainland-China-vs-international heuristic that `search_places`/`get_poi_details`/`calculate_distance` all branch on.
- `amap.ts` — thin client for Amap (高德) Web Service REST API (text search, POI detail, distance) — used for mainland China.
- `mapbox.ts` — despite the name, now mostly OpenStreetMap-backed (Mapbox's Search Box API turned out to be session-billed and was racking up charges — see the file's module docstring for the full history). Orchestrates `searchPlaces`/`getPoiDetails`/`calculateDistance` for international destinations across a multi-provider fallback chain — see `geoapify.ts` below and the README's "Reliability engineering" section for why it's shaped this way.
- `geoapify.ts` — Geoapify Places + Routing client, the **primary** provider internationally (commercially-hosted free tier; added after live eval runs showed the free public Overpass ecosystem failing 100% of search calls twice). `mapbox.ts` falls through to Overpass (primary + independent mirror) → OpenRouteService → Mapbox → a haversine estimate only if Geoapify is unset or fails.
- `wikivoyage.ts` — `get_destination_context(destination, topic)`, Wikivoyage's MediaWiki API (CC BY-SA 4.0), NOT provider-routed (works for any destination). Grounds `aiNote`/summary copy; optional, the model decides whether to call it.
- `attributions.ts` — `computeSourceAttributions`/`computeGroundingWarning`, pure functions of a run's tool-call trace, shared by `server.ts` (the real route) and `tests/eval/run-eval.ts` (the eval harness) so both compute the same UI attribution/honesty-disclaimer signals — see its module docstring for a bug this fixed.
- `http.ts` — shared `createThrottledFetch(options)` (per-host spacing/retry/timeout) + `readErrorBody`, used by every external client above.
- **4 of the 7 tools in the PRD are implemented**: `search_places`, `get_poi_details`, `calculate_distance`, `get_destination_context`. See Known Gaps for the rest.
- Each tool call is wrapped in try/catch in the agent loop; a thrown error becomes `{ error: message }` fed back to the model as a tool result, not a hard failure — the model is instructed (system prompt) to keep planning with general knowledge rather than give up.

### Error-recovery layers

Recovery is handled at multiple independent layers, each covering a different failure mode:

1. **Per-tool-call** (`agent.ts`): tool exceptions are caught and turned into `{error}` tool results so the model can react instead of the request crashing.
2. **Non-JSON final answer** (`agent.ts`): if the model's non-tool-call reply isn't valid JSON, one retry is issued with an explicit "you MUST emit a complete itinerary JSON now" instruction and `response_format: json_object`.
3. **Step-cap fallback** (`agent.ts`): if `maxSteps` is exhausted without a final answer, one forced no-tools completion produces the itinerary anyway.
4. **Prompt-level tolerance** (`agent.ts` system prompt): explicitly tells the model to fall back to general knowledge (plausible coordinates, well-known POIs) when Amap tools return empty — this matters for non-mainland-China destinations, where Amap has no data.
5. **Server route** (`server.ts` `/api/generate-itinerary`): wraps the whole agent call in try/catch → 500 with a generic user-facing message; also logs a valid-coordinate count/sample for debugging bad LLM output.
6. **Image proxy** (`server.ts` `/api/image-proxy`): Amap photo URLs lack CORS, so exports need them proxied; the proxy also repairs LLM-mangled URLs (strips cache-bust query contamination, un-double-encodes) and serves a transparent-pixel PNG placeholder instead of erroring when the LLM hallucinates a nonexistent image URL.
7. **Client schema validation** (`src/lib/validateItinerary.ts`): structural check of agent output (day numbers, slot periods, coordinate ranges, required fields) producing `error`/`warning` issues — used by tests today; intended as a pre-persist guard.
8. **UI-level** (`src/components/ErrorBoundary.tsx`, `UndoSnack.tsx`): a React error boundary catches render-time crashes with a retry/reload affordance; edit operations (drag/delete/move) are undoable via a snackbar rather than requiring confirmation dialogs.

Note: `validate_itinerary` (LLM-as-judge, auto-correct) described in the PRD as step 5 of the agent flow is **not** wired into the agent loop — there's a separate, disconnected `/api/verify-itinerary` route (see Known Gaps).

### Observability (`opts.stepTrace`, `server/logs/traces/`)

Independent of `opts.trace` (the flat `ToolCallRecord[]` the eval harness's scoring math reads — see below), `generateItinerary` also populates `opts.stepTrace: AgentStepRecord[]` when passed — one entry per loop iteration, grouping that step's reasoning text with its tool calls. `server.ts` gives every `/api/generate-itinerary` request a `requestId`, persists `{requestId, destination, durationMs, error, steps}` to `server/logs/traces/<requestId>.json` (no retention/cleanup policy yet), and exposes it at `GET /api/trace/:requestId`. `src/components/TraceViewer.tsx` renders it, gated behind `?debug=1` (persisted via localStorage) — a "View agent trace" link appears on the itinerary when both the debug flag and a `requestId` are present.

### Client memory (`src/lib/memory.ts`)

A `localStorage`-backed `TravelMemory` profile (preferred vibes, group type, budget lean, past destinations, place types the user tends to delete) folded into the next generation's prompt as an explicitly-soft "returning user context" block — current form fields always win on conflict. Per-browser only, not synced to a Supabase account across devices (see Known Gaps).

## Tech stack

- **Frontend:** React 19 + TypeScript, Vite 6, Tailwind CSS v4, `motion` (animation), `@dnd-kit/*` (drag-and-drop), `lucide-react` (icons)
- **Server:** Express, run via `tsx` in dev (Vite in middleware mode) and bundled with `esbuild` (CJS) for prod (`dist/server.cjs`)
- **AI:** DeepSeek (`deepseek-chat`) via the `openai` SDK against `https://api.deepseek.com` (OpenAI-compatible function calling)
- **Maps:** Amap (高德) JS SDK, loaded via `@amap/amap-jsapi-loader`, used through the global `window.AMap` for map rendering + China place data. `@vis.gl/react-google-maps` is a dependency but not wired up anywhere in `src/`. International place/routing data: Geoapify (primary) → OSM Overpass/Nominatim → OpenRouteService → Mapbox — see `server/tools/mapbox.ts`/`geoapify.ts`.
- **Backend/data:** Supabase (`@supabase/supabase-js`) — Auth + Postgres, client at `src/supabase.ts`
- **Export:** `html-to-image`/`html2canvas` (long image) + `jspdf` (PDF)
- **Testing:** Vitest (unit/component, `tests/unit/`), a separate Vitest config for LLM-judge fuzzy tests (`vitest.fuzzy.config.ts`, `tests/fuzzy/`), Playwright (`tests/e2e/`), a standalone agent eval harness (`tests/eval/`, not CI-gating — see its own README-level comment at the top of `tests/eval/run-eval.ts`)
- **Deploy:** frontend on Cloudflare Pages (`https://wayfound-ezv.pages.dev`), backend (Express server) on Railway; CORS in `server.ts` is hardcoded to the Pages origin + `*.pages.dev` + localhost

## Key directories / entry points

| Path | Purpose |
|---|---|
| `server.ts` | Express app: API routes, static/Vite serving, CORS, image proxy |
| `server/agent.ts` | Agent loop, system prompt, itinerary schema hint |
| `server/tools/` | Tool schemas + handlers + Amap/Mapbox-OSM/Geoapify/Wikivoyage clients (see Tool layer above) |
| `src/components/TraceViewer.tsx` | Debug-gated (`?debug=1`) reasoning/tool-call trace viewer, reads `GET /api/trace/:requestId` |
| `src/lib/memory.ts` | Returning-user preference memory (`localStorage`), folded into the next generation's prompt |
| `tests/eval/` | Standalone live agent eval harness — `run-eval.ts`, `scoring.ts`, `cases.json`; see README |
| `src/main.tsx` → `src/App.tsx` → `src/components/ItineraryApp.tsx` | React entry → top-level state/orchestration (form → generate → edit → export) |
| `src/components/PlanningForm.tsx`, `AIClarification.tsx` | Trip input form + clarification bubbles |
| `src/components/ItineraryPane.tsx`, `MapPane.tsx`, `PlaceCard.tsx` | Day/TimeSlot list, Amap map + pins/polyline, place cards |
| `src/components/PlaceSearchModal.tsx` | Search-and-add-place flow |
| `src/components/BottomSheet.tsx`, `SidePanel.tsx`, `useDrawerSnap.ts` | Mobile half-sheet vs. desktop split layout |
| `src/lib/itineraryOps.ts` | Pure functions: move/delete/insert/change-slot on itinerary state |
| `src/lib/validateItinerary.ts` | Schema validation for agent output |
| `src/lib/clarifications.ts` | Rule-based (non-LLM) clarification-question generation |
| `src/lib/export.ts` | Long-image + PDF export |
| `src/types.ts` | Core data model (`Itinerary`/`Day`/`TimeSlot`/`Place`, form/clarification types) |
| `tests/unit/`, `tests/fuzzy/`, `tests/e2e/` | Vitest unit, LLM-judge fuzzy (per SPEC §7.3 rubric), Playwright E2E |
| `supabase/` | DB setup (see `docs/SUPABASE_SETUP.md`) |

## Known gaps (vs. PRD/SPEC)

- **3 of 7 agent tools missing:** `get_weather`, `search_flights`, `search_hotels` are specced but not implemented (`get_destination_context` closes the gap on grounding, but isn't a PRD tool by that name). No weather-aware scheduling, no flight/hotel search+deeplink (PRD §3.6).
- **`validate_itinerary` not in the agent loop:** `/api/verify-itinerary` exists as a standalone DeepSeek-as-critic endpoint but the agent's own generation flow doesn't call it or auto-correct — Step 5 of PRD §6.3 is unimplemented.
- **International place/POI data is best-effort, not guaranteed:** Geoapify (primary) → OSM Overpass (primary + mirror) → the model's own general knowledge as the final fallback — a real improvement over the old "Amap-only, nothing verified internationally" state, but still not a single reliable source of truth; see the README's "Reliability engineering" section for the eval data behind this design. `MapPane.tsx` still only renders Amap — Mapbox/Google Maps map *rendering* (PRD §5.1/§5.2) isn't implemented, only search/routing *data* is.
- **No AI proactive itinerary-issue detection UI** (PRD §3.5 non-blocking warning strips — over-packed days, route backtracking, missing meals) — `validateItinerary.ts` covers schema-level checks only, not the qualitative rubric. (`computeGroundingWarning` is a narrower, different thing — a data-provenance disclaimer, not itinerary-quality detection.)
- **Account/cloud persistence is partial:** Supabase client and `SharedItineraryView.tsx` exist, but "my trips" list / multi-device sync (PRD §3.7, SPEC Sprint 6) status should be confirmed against `supabase/` migrations before relying on it. Returning-user *memory* (as opposed to saved trips) is `localStorage`-only, not account-synced at all — see `src/lib/memory.ts` above.
- **`ToolContext` POI cache is per-request/in-memory:** fine for a single agent run, but `get_poi_details`/`calculate_distance` will fail with "Unknown POI id" if the model references a POI id from outside the current run, or invents one that was never actually returned by `search_places` — confirmed live in eval runs (the model occasionally does this; `tests/eval/scoring.ts`'s `scoreToolCallCorrectness` tracks it as `invalidPoiRefs`).
- **Trace files have no retention policy:** `server/logs/traces/*.json` accumulate indefinitely — fine for local/demo use, needs a cleanup job before any real production use.
