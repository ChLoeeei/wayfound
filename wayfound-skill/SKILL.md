---
name: wayfound-builder
description: >
  Complete step-by-step build guide for Wayfound, an AI-powered travel itinerary
  planning tool. Use this skill whenever building, continuing, or debugging any
  part of the Wayfound product. Covers all 7 development phases, testing gates,
  tech stack decisions, and the full PRD. Always read this skill before writing
  any Wayfound code, even for small tasks — it contains critical architecture
  decisions and testing requirements that must be respected at every phase.
---

# Wayfound Builder Skill

## Overview

Wayfound is an AI travel itinerary planner. Users fill a one-screen form → AI
generates a day-by-day itinerary → user edits freely via drag-and-drop →
map and list stay in sync at all times.

**Golden rule: every phase must pass its test gate before the next phase begins.**
Never skip gates. If a gate fails, fix it before continuing.

---

## Quick Reference

| Item | Decision |
|------|----------|
| Frontend | React + TypeScript + Tailwind CSS |
| Backend / DB | Supabase (auth + postgres + storage) |
| Deployment | Vercel |
| AI Model | DeepSeek API (`deepseek-chat`) |
| Map (domestic CN) | Amap (高德) API |
| Map (international) | Mapbox GL JS |
| Agent pattern | Tool-use: fixed tools, AI chooses order |
| Itinerary unit | Place + time-slot (morning/afternoon/evening) |
| Mobile layout | Half-screen drawer (map top, list bottom, draggable divider) |
| UI style | Immersive large-image (landing) + clean cards (planner) |
| Validation | LLM-as-Judge with 7-dimension Rubric (see references/rubric.md) |

For full PRD see `references/prd.md`.  
For data models see `references/data-models.md`.  
For the Rubric scoring system see `references/rubric.md`.  
For tool definitions see `references/tools.md`.

---

## Development Phases

```
Phase 1 → Project Scaffold & CI
Phase 2 → Input Form & DeepSeek Integration
Phase 3 → Itinerary Display (list view)
Phase 4 → Map Integration & Sync
Phase 5 → Editing Operations
Phase 6 → AI Validation Layer
Phase 7 → Hotels/Flights + Auth + Export
```

Each phase: **Build → Test → Gate → Next phase.**

---

## Phase 1 — Project Scaffold & CI

### What to build
- Vite + React + TypeScript project
- Tailwind CSS configured with Wayfound design tokens (see `references/design-tokens.md`)
- Supabase project created; `.env` with all keys
- Vercel project linked to repo, auto-deploy on `main`
- ESLint + Prettier configured
- Vitest + Playwright installed

### File structure
```
wayfound/
├── src/
│   ├── components/      # UI components
│   ├── hooks/           # Custom React hooks
│   ├── lib/
│   │   ├── supabase.ts  # Supabase client
│   │   ├── deepseek.ts  # AI client + tool runner
│   │   ├── amap.ts      # Amap helpers
│   │   └── mapbox.ts    # Mapbox helpers
│   ├── types/           # TypeScript interfaces (from data-models.md)
│   ├── pages/
│   │   ├── Landing.tsx  # Form page
│   │   └── Planner.tsx  # Itinerary editor
│   └── App.tsx
├── tests/
│   ├── unit/            # Vitest unit tests
│   └── e2e/             # Playwright tests
└── supabase/
    └── migrations/      # DB schema files
```

### Phase 1 gate ✅
- [ ] `npm run dev` starts without errors
- [ ] `npm run test` passes (even with 0 tests — just confirm setup works)
- [ ] Vercel deployment URL is live and loads a blank page
- [ ] Supabase connection verified (`supabase.from('test').select()` returns no error)

---

## Phase 2 — Input Form & AI Generation

### What to build

**Landing page form fields:**
| Field | Component |
|-------|-----------|
| Destination | Searchable input with autocomplete (use Amap/Mapbox geocoding) |
| Date range | Date range picker (start + end date) |
| Group size + type | Stepper + radio (solo / couple / friends / family) |
| Vibe | Multi-select tags: Nature / Culture / Food / Shopping / Leisure / Adventure |
| Budget | Range slider (CNY per person per day) |
| Special needs | Optional multi-select tags |

**AI generation flow:**
1. Form submits → validate required fields client-side
2. If Vibe is vague: show max 2 AI follow-up bubble questions (user can skip)
3. Call DeepSeek with tools (see `references/tools.md` for exact tool specs)
4. Show skeleton loading state during generation (target: < 10s)
5. On success: navigate to Planner page with itinerary in state

**DeepSeek system prompt** (keep in `lib/deepseek.ts`):
```
You are Wayfound, an expert travel planner. Given user preferences,
generate a detailed day-by-day itinerary. Use your tools to fetch real
place data, check weather, and optimize routing. Return a structured
itinerary matching the Itinerary TypeScript type exactly.
Always respond in the language the user used.
```

**Tool call sequence (AI decides order, these are available):**
- `get_weather` → flag outdoor-unfriendly days
- `search_places` × multiple calls → fetch attractions + restaurants by vibe
- `calculate_distance` → cluster nearby places to minimize travel
- `validate_itinerary` → Rubric check before returning to user

### Phase 2 gate ✅
- [ ] Form validates: empty required fields show inline errors, not alerts
- [ ] Destination autocomplete returns results within 1s
- [ ] AI generation completes in < 10s for a 3-day trip (measure P95 over 10 runs)
- [ ] Generated itinerary covers every requested day with morning/afternoon/evening slots
- [ ] If DeepSeek API fails: user sees a friendly retry message, not a stack trace
- [ ] **Rubric gate**: run 10 generated itineraries through `references/rubric.md` scorer.
  Weighted average must be ≥ 3.5 / 5.0 across all 10. Log per-dimension scores.

---

## Phase 3 — Itinerary List View

### What to build

**Planner page — list panel:**
- Day tabs at top (Day 1, Day 2, … Day N)
- Each day: three time-slot sections (Morning / Afternoon / Evening)
- Each slot: list of Place cards + an "+ Add place" button at bottom of slot

**Place card (rich / C-variant):**
```
┌─────────────────────────────────────────┐
│ [60×60 img]  Place Name          [slot] │
│              ⭐ 4.8  ¥60  Type · 2h    │
│                                    [›]  │  ← expand
└─────────────────────────────────────────┘
```
Expanded state shows:
- AI recommendation note
- Opening hours
- External link (Dianping / Google Maps)
- AI warning badge (if validation flagged this place)

**AI warning badges** (non-blocking, inline):
- ⚠️ Too many places this day
- 🔄 Route backtrack detected
- 🍽️ No meal in this slot
- 📍 Far from other places today

### Phase 3 gate ✅
- [ ] All days render without layout overflow on iPhone 14 viewport (390px wide)
- [ ] Place cards show image, rating, cost, duration
- [ ] Expand/collapse animation is smooth (no layout shift)
- [ ] Day tab switching is instant (no re-fetch)
- [ ] "+ Add place" button is visible and tappable in each slot
- [ ] Long place names truncate with ellipsis, do not break layout

---

## Phase 4 — Map Integration & Sync

### Map provider selection logic
```typescript
// lib/mapProvider.ts
const CN_DESTINATIONS = ['中国','北京','上海', /* ... */]
export const getProvider = (destination: string) =>
  CN_DESTINATIONS.some(c => destination.includes(c)) ? 'amap' : 'mapbox'
```

### What to build

**Mobile layout (half-screen drawer):**
```
┌──────────────────────┐
│   MAP (top half)     │  ← pins for current day's places
│   route polyline     │  ← dashed line connecting places in order
├──────────────────────┤  ← draggable divider
│ [Day tabs]           │
│ [Place card list]    │  ← scrollable
└──────────────────────┘
```
- Dragging divider up → list expands, map shrinks to top strip
- Dragging divider down → map expands, list shrinks to bottom strip

**Sync rules:**
- Tap place card → map pans to that pin, pin pulses
- Tap map pin → list scrolls to that card, card highlights
- Switch day tab → map re-renders with new day's places + route

**Desktop layout:**
- Left panel: day tabs + card list (fixed width 380px)
- Right panel: full-height map
- Same sync rules apply

### Phase 4 gate ✅
- [ ] Map loads within 2s on first render
- [ ] All places for current day appear as pins on map
- [ ] Route polyline connects pins in correct order
- [ ] Tapping card → map pin highlights (and vice versa)
- [ ] Switching day tabs re-renders map correctly
- [ ] Draggable divider works on touch (mobile) and mouse (desktop)
- [ ] Map renders correctly for both CN (Amap) and international (Mapbox) destinations
- [ ] No console errors from map library on any interaction

---

## Phase 5 — Editing Operations

Build in this order (each is independently testable):

### 5a. Move (drag to reorder within same day)
- Long-press a card → enter drag mode
- Drag to different slot (morning/afternoon/evening) or different position
- Drop → update itinerary state → map re-renders route

### 5b. Delete
- Left-swipe card → reveal red delete button
- Confirm tap → remove from state
- Undo toast appears for 4s

### 5c. Insert / Add place
- Tap "+ Add place" in any slot
- Opens search sheet (searchable list + map picker tab)
- Select place → inserted into that slot

### 5d. Adjust time slot
- On expanded card: dropdown to change Morning / Afternoon / Evening
- Updates state immediately

### 5e. Replace (Phase 2 editing)
- On expanded card: "Replace" button
- Opens same search sheet as Insert
- Selected place replaces current one, preserving position

### 5f. Regenerate day (Phase 2 editing)
- Day tab long-press or header button: "Regenerate Day"
- Calls DeepSeek with same user prefs + "exclude these places: [already visited]"
- Shows skeleton while loading, replaces day on success

### Phase 5 gate ✅
- [ ] Drag-and-drop works on touch (no accidental scroll triggers)
- [ ] Delete + undo works; deleted place is fully restored on undo
- [ ] Adding a place via search inserts it into correct slot
- [ ] Adding a place via map pin inserts it into correct slot
- [ ] All edits persist in Supabase (refresh page → edits still there)
- [ ] Map updates within 300ms of any edit (no stale pins)
- [ ] **E2E Playwright test**: full editing flow
  ```
  Load itinerary → delete Day 1 place → undo → 
  drag place to different slot → add new place via search → 
  verify map shows 3 changes correctly
  ```

---

## Phase 6 — AI Validation Layer

### What to build

**Real-time itinerary analysis:**
- After every edit (debounced 1.5s), send current day to DeepSeek for validation
- DeepSeek uses `validate_itinerary` tool (see `references/tools.md`)
- Results surface as inline warning badges on cards (see Phase 3)
- Warnings are non-blocking — user can always ignore

**In-planner AI chat:**
- Collapsed by default: small "Ask AI" FAB (floating action button)
- Tap → slide-up sheet with chat input
- AI has full itinerary as context, can suggest specific changes
- User can say "apply this suggestion" → AI makes the edit programmatically

**Validation debounce rule:**
- Do NOT call validation on every keystroke or every drag event
- Call ONLY after: drag-drop settled, delete confirmed, place added, 1.5s idle

### Phase 6 gate ✅

**Deterministic checks:**
- [ ] Validation does NOT fire during active drag (only after drop)
- [ ] Warning badges appear within 3s of an edit
- [ ] No duplicate API calls (debounce working correctly — verify in Network tab)
- [ ] AI chat has correct itinerary context (ask "how many places on Day 1?" — answer must match)

**Fuzzy / Rubric gate:**
Run 20 itineraries (mix of good and intentionally bad ones) through validator:
- [ ] Validator correctly flags days with > 4 places in ≥ 90% of cases
- [ ] Validator correctly flags missing meals in ≥ 85% of cases
- [ ] Weighted Rubric score for "good" itineraries ≥ 3.5 / 5.0
- [ ] Weighted Rubric score for "bad" itineraries ≤ 2.5 / 5.0
See `references/rubric.md` for full scoring prompt and weightings.

---

## Phase 7 — Hotels, Flights, Auth & Export

### 7a. Hotels & Flights (query + redirect)
- "Find hotels" button on each day's accommodation slot
- Queries: destination city + check-in/check-out dates
- Displays: name, price, rating, image, booking link
- Tap booking link → open third-party URL in new tab (no in-app payment)
- Same pattern for flights: origin (ask user once, cache) + destination + dates

### 7b. Auth (Google OAuth via Supabase)
- Landing page: "Sign in with Google" link (optional, can generate anonymously)
- After generation: prompt "Save your itinerary? Sign in →"
- Signed-in users: itineraries auto-saved to Supabase `itineraries` table
- Anonymous users: itinerary in localStorage only (warn on close)

### 7c. Export
- "Export" button in planner header → bottom sheet with options:
  - **Long image** (PNG): render itinerary as vertical card, use `html2canvas`
  - **PDF**: same render → `jsPDF`
  - **Share link**: generate public read-only URL (`/share/[uuid]`)

### Phase 7 gate ✅
- [ ] Hotel results appear within 3s
- [ ] Clicking hotel link opens correct third-party URL
- [ ] Google sign-in completes without error (test with real Google account)
- [ ] After sign-in: itinerary is visible after hard refresh
- [ ] Long image export: all days visible, no text clipping
- [ ] PDF export: opens in browser PDF viewer without error
- [ ] Share link: opens in incognito window and shows correct itinerary (read-only)

---

## Cross-Phase Rules

### Never break these
1. **Map always reflects list state.** Any state change → map re-renders within 300ms.
2. **Edits always persist.** Any change → Supabase write within 2s (show saving indicator).
3. **AI errors never crash the UI.** Wrap all DeepSeek calls in try/catch; show retry UI.
4. **Mobile-first.** Test every new component at 390px width before desktop.
5. **No localStorage for itinerary data** (except anonymous fallback in Phase 7).

### Error handling template
```typescript
try {
  const result = await callDeepSeek(payload)
  // handle success
} catch (err) {
  console.error('[Wayfound]', err)
  showToast('Something went wrong. Tap to retry.', { action: retry })
}
```

### Performance budgets
| Metric | Target |
|--------|--------|
| Itinerary generation | P95 < 10s |
| Map render on day switch | < 300ms |
| Card expand/collapse | < 150ms |
| Validation feedback | < 3s after edit |
| Export (image/PDF) | < 5s |

---

## Testing Quick Reference

| Phase | Deterministic Tool | Fuzzy Tool |
|-------|--------------------|------------|
| 2 (Generation) | Vitest: field coverage, timing | Rubric: 10 itineraries ≥ 3.5 avg |
| 3 (List UI) | Vitest: render, layout | Manual: card readability |
| 4 (Map) | Playwright: pin sync, route | Manual: visual correctness |
| 5 (Editing) | Playwright: full editing E2E | Manual: drag feel on mobile |
| 6 (Validation) | Vitest: debounce, no crashes | Rubric: 20 cases, flag accuracy |
| 7 (Auth/Export) | Playwright: sign-in flow, export | Manual: export visual quality |

Full Rubric spec → `references/rubric.md`  
Full tool definitions → `references/tools.md`

---

## References Index

| File | Contents |
|------|----------|
| `references/prd.md` | Full Product Requirements Document |
| `references/data-models.md` | TypeScript interfaces for all data types |
| `references/tools.md` | DeepSeek tool definitions (JSON schema) |
| `references/rubric.md` | 7-dimension Rubric + scoring prompt |
| `references/design-tokens.md` | Colors, fonts, spacing for Wayfound UI |
