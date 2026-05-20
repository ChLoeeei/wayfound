# Wayfound — Rubric Scoring System

Used in Phase 2 and Phase 6 for fuzzy (LLM-as-Judge) itinerary validation.

---

## 7 Dimensions

| # | Dimension | Weight | Key Question |
|---|-----------|--------|--------------|
| ① | Route Logic | 20% | Are adjacent places geographically clustered? No backtracking? |
| ② | Time Allocation | 20% | Is each day's pace sustainable? Not too packed, not too empty? |
| ③ | Meal Coverage | 10% | Does each day have breakfast/lunch/dinner covered? |
| ④ | Physical Intensity | 10% | Does the intensity match the group type (family/elderly/solo)? |
| ⑤ | Budget Match | 10% | Do recommended places fit the stated budget? |
| ⑥ | Vibe Match | 20% | Do places reflect the user's stated vibes? |
| ⑦ | Weather Adaptation | 10% | Are outdoor plans adjusted for weather risk on that date? |

**Pass threshold: weighted total ≥ 3.5 / 5.0**

---

## Scoring Guide Per Dimension

### ① Route Logic (weight 0.20)
- **5** — All places within each day are geographically tight (< 3km radius or one clear direction of travel). No backtracking.
- **3** — Minor detour (< 20 min extra travel) but overall logical.
- **1** — Significant backtracking (e.g. north side → south side → north side), adds 1h+ unnecessary travel.

### ② Time Allocation (weight 0.20)
- **5** — 3–4 places per day. Each place has realistic duration. Day ends by ~21:00.
- **3** — 5 places, slightly tight but feasible.
- **1** — 6+ places, or major time gaps with nothing scheduled.

### ③ Meal Coverage (weight 0.10)
- **5** — Lunch and dinner placed in afternoon/evening slots. Breakfast mentioned if hotel doesn't include it.
- **3** — One meal missing or at a slightly wrong time.
- **1** — No meal places in the itinerary at all.

### ④ Physical Intensity (weight 0.10)
- **5** — Perfectly matched. Family with kids: no 3h walks. Solo adventurer: challenging activities OK.
- **3** — Slightly above/below appropriate level but manageable.
- **1** — Completely mismatched (e.g. 15km hiking day for elderly group).

### ⑤ Budget Match (weight 0.10)
- **5** — Estimated daily spend is within 10% of stated budget.
- **3** — 10–25% over or under budget.
- **1** — More than 25% over budget with no note.

### ⑥ Vibe Match (weight 0.20)
- **5** — ≥ 80% of places match the user's stated vibes.
- **3** — 50–80% match.
- **1** — < 50% match (e.g. user said "food" but itinerary is mostly museums).

### ⑦ Weather Adaptation (weight 0.10)
- **5** — If weather risk exists (rain season, extreme heat), outdoor activities reduced or indoor alternatives added.
- **3** — Minor weather mismatch but not critical.
- **1** — Heavy outdoor schedule on days forecasted for heavy rain, no alternatives.

---

## Scoring Prompt (send to DeepSeek as judge)

```
You are an expert travel planner evaluating an AI-generated itinerary.
Score it on 7 dimensions using the rubric below.
Return ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

USER PROFILE:
{user_profile_json}

ITINERARY:
{itinerary_json}

RUBRIC:
① Route Logic (weight 0.20): Are places per day geographically clustered? No backtracking?
② Time Allocation (weight 0.20): 3-4 places/day? Realistic durations? Not too packed?
③ Meal Coverage (weight 0.10): Lunch + dinner in each day?
④ Physical Intensity (weight 0.10): Matches group type (family/solo/elderly)?
⑤ Budget Match (weight 0.10): Estimated cost within stated budget?
⑥ Vibe Match (weight 0.20): ≥ 80% of places match stated vibes?
⑦ Weather Adaptation (weight 0.10): Outdoor plans adjusted for weather risk?

Score each 1-5 (1=poor, 3=acceptable, 5=excellent).

Return format:
{
  "scores": {
    "route_logic":          { "score": N, "reason": "one sentence" },
    "time_allocation":      { "score": N, "reason": "one sentence" },
    "meal_coverage":        { "score": N, "reason": "one sentence" },
    "physical_intensity":   { "score": N, "reason": "one sentence" },
    "budget_match":         { "score": N, "reason": "one sentence" },
    "vibe_match":           { "score": N, "reason": "one sentence" },
    "weather_adaptation":   { "score": N, "reason": "one sentence" }
  },
  "weighted_total": X.X,
  "pass": true_or_false,
  "top_issue": "one sentence describing the biggest problem if any"
}
```

---

## How to Run Batch Rubric Tests

```typescript
// tests/rubric/batch-score.ts
import { scoreItinerary } from './scorer'
import testCases from './test-cases.json'

const results = await Promise.all(
  testCases.map(tc => scoreItinerary(tc.userProfile, tc.itinerary))
)

const avg = results.reduce((sum, r) => sum + r.weighted_total, 0) / results.length
const passRate = results.filter(r => r.pass).length / results.length

console.log(`Average score: ${avg.toFixed(2)} / 5.0`)
console.log(`Pass rate: ${(passRate * 100).toFixed(0)}%`)
// Gate: avg >= 3.5 AND passRate >= 0.80
```

---

## Test Case Template

```json
{
  "id": "TC-001",
  "description": "5-day Kyoto, couple, culture + food vibe, mid budget",
  "userProfile": {
    "destination": "京都, 日本",
    "startDate": "2026-10-01",
    "endDate": "2026-10-05",
    "groupSize": 2,
    "groupType": "couple",
    "vibes": ["culture", "food"],
    "budgetPerDayPerPerson": 800,
    "specialNeeds": []
  },
  "itinerary": { /* Itinerary object */ },
  "expectedResult": "pass",
  "notes": "Rainy season — check weather adaptation score"
}
```

Maintain at least 20 test cases: 12 "should pass", 8 "should fail".
Store in `tests/rubric/test-cases.json`.
