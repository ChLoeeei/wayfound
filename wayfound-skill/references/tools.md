# Wayfound — DeepSeek Tool Definitions

These are the fixed tools available to the DeepSeek agent.
The agent chooses which tools to call and in what order.
Do NOT add tools without updating this file and SKILL.md.

---

## Tool: search_places

```json
{
  "name": "search_places",
  "description": "Search for tourist attractions, restaurants, cafes, or other POIs in a city. Returns a list of places with coordinates, ratings, cost estimates, and opening hours.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search term, e.g. '京都传统神社' or 'Kyoto ramen restaurants'"
      },
      "city": {
        "type": "string",
        "description": "City name for context, e.g. '京都' or 'Kyoto'"
      },
      "type": {
        "type": "string",
        "enum": ["attraction", "restaurant", "cafe", "shopping", "other"],
        "description": "Type of place to search for"
      },
      "maxResults": {
        "type": "number",
        "description": "Maximum number of results to return (default 5, max 10)"
      }
    },
    "required": ["query", "city"]
  }
}
```

**Implementation:** Route to Amap or Mapbox based on `mapProvider` from itinerary.

---

## Tool: get_poi_details

```json
{
  "name": "get_poi_details",
  "description": "Get detailed information about a specific place by its ID.",
  "parameters": {
    "type": "object",
    "properties": {
      "placeId": {
        "type": "string",
        "description": "The place ID returned by search_places"
      },
      "provider": {
        "type": "string",
        "enum": ["amap", "mapbox"],
        "description": "Which map provider this ID belongs to"
      }
    },
    "required": ["placeId", "provider"]
  }
}
```

---

## Tool: get_weather

```json
{
  "name": "get_weather",
  "description": "Get weather forecast for a destination during the trip dates. Returns daily summaries including rain probability and temperature.",
  "parameters": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "City name"
      },
      "startDate": {
        "type": "string",
        "description": "ISO date string e.g. '2026-06-01'"
      },
      "endDate": {
        "type": "string",
        "description": "ISO date string e.g. '2026-06-05'"
      }
    },
    "required": ["city", "startDate", "endDate"]
  }
}
```

**Implementation:** OpenWeather One Call API 3.0 (free tier: 1000 calls/day).

---

## Tool: calculate_distance

```json
{
  "name": "calculate_distance",
  "description": "Calculate travel distance and estimated time between two coordinates. Use this to verify that places within a day are geographically close.",
  "parameters": {
    "type": "object",
    "properties": {
      "origin": {
        "type": "object",
        "properties": {
          "lat": { "type": "number" },
          "lng": { "type": "number" }
        },
        "required": ["lat", "lng"]
      },
      "destination": {
        "type": "object",
        "properties": {
          "lat": { "type": "number" },
          "lng": { "type": "number" }
        },
        "required": ["lat", "lng"]
      },
      "mode": {
        "type": "string",
        "enum": ["walking", "transit", "driving"],
        "description": "Travel mode (default: transit)"
      }
    },
    "required": ["origin", "destination"]
  }
}
```

---

## Tool: search_hotels

```json
{
  "name": "search_hotels",
  "description": "Search for hotels at the destination for the trip dates. Returns a list with prices, ratings, and booking links.",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string" },
      "checkin": { "type": "string", "description": "ISO date" },
      "checkout": { "type": "string", "description": "ISO date" },
      "guests": { "type": "number" },
      "budgetPerNight": { "type": "number", "description": "Max CNY per night" }
    },
    "required": ["city", "checkin", "checkout", "guests"]
  }
}
```

**Implementation:** Booking.com Affiliate API or Trip.com Open API.  
Result includes `bookingUrl` — always open in new tab, never in-app.

---

## Tool: search_flights

```json
{
  "name": "search_flights",
  "description": "Search for flights between two cities on given dates.",
  "parameters": {
    "type": "object",
    "properties": {
      "origin": { "type": "string", "description": "IATA code or city name" },
      "destination": { "type": "string", "description": "IATA code or city name" },
      "departDate": { "type": "string", "description": "ISO date" },
      "returnDate": { "type": "string", "description": "ISO date, optional for one-way" },
      "passengers": { "type": "number" }
    },
    "required": ["origin", "destination", "departDate", "passengers"]
  }
}
```

**Implementation:** Amadeus Flight Offers Search API (free test environment available).

---

## Tool: validate_itinerary

```json
{
  "name": "validate_itinerary",
  "description": "Validate a day's itinerary using the 7-dimension Rubric. Returns scores, warnings, and a pass/fail result. Call this after generating or editing an itinerary.",
  "parameters": {
    "type": "object",
    "properties": {
      "userProfile": {
        "type": "object",
        "description": "The original TripFormInput object"
      },
      "day": {
        "type": "object",
        "description": "A single Day object from the itinerary"
      }
    },
    "required": ["userProfile", "day"]
  }
}
```

**Implementation:** This tool internally calls DeepSeek with the Rubric prompt
from `references/rubric.md`. It is a recursive AI call — use a separate
lightweight DeepSeek call (not the main planning call) with `max_tokens: 500`.

**Response shape:**
```typescript
interface ValidationResult {
  scores: Record<string, { score: number; reason: string }>
  weighted_total: number
  pass: boolean
  warnings: Warning[]   // mapped from low-scoring dimensions
  top_issue: string | null
}
```

---

## Adding Tools

Before adding a new tool:
1. Document it here following the pattern above
2. Update the tool list in SKILL.md Quick Reference
3. Update the DeepSeek system prompt if the new tool changes the agent's behavior
4. Write a unit test for the tool's API call (mock the external API)
