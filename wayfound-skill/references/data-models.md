# Wayfound — Data Models

All TypeScript interfaces used across the Wayfound codebase.
These are the source of truth. Do not deviate without updating this file.

---

## Core Types

```typescript
// ─── User ───────────────────────────────────────────────
interface User {
  id: string
  email: string
  createdAt: string
}

// ─── Itinerary (top level) ──────────────────────────────
interface Itinerary {
  id: string
  userId: string | null        // null = anonymous
  destination: string          // e.g. "京都, 日本"
  destinationCoords: LatLng
  startDate: string            // ISO date "2026-06-01"
  endDate: string
  groupSize: number
  groupType: 'solo' | 'couple' | 'friends' | 'family'
  vibes: Vibe[]
  budgetPerDayPerPerson: number // CNY
  specialNeeds: SpecialNeed[]
  days: Day[]
  mapProvider: 'amap' | 'mapbox'
  createdAt: string
  updatedAt: string
}

// ─── Day ────────────────────────────────────────────────
interface Day {
  dayNumber: number            // 1-indexed
  date: string                 // ISO date
  slots: {
    morning: Place[]
    afternoon: Place[]
    evening: Place[]
  }
  validationWarnings: Warning[]
}

// ─── Place ──────────────────────────────────────────────
interface Place {
  id: string                   // unique within itinerary
  name: string
  type: PlaceType
  coordinates: LatLng
  rating: number               // 0-5
  estimatedCostCNY: number     // per person
  durationMinutes: number      // suggested stay
  imageUrl: string
  aiNote: string               // why AI recommended this
  externalUrl: string          // Dianping / Google Maps link
  openingHours?: string
  warnings: Warning[]          // place-specific validation warnings
}

// ─── Warning ────────────────────────────────────────────
interface Warning {
  type: WarningType
  message: string
  severity: 'info' | 'warning' | 'error'
}

// ─── Supporting types ────────────────────────────────────
interface LatLng {
  lat: number
  lng: number
}

type Vibe =
  | 'nature'
  | 'culture'
  | 'food'
  | 'shopping'
  | 'leisure'
  | 'adventure'

type PlaceType =
  | 'attraction'
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'shopping'
  | 'transport'
  | 'other'

type SpecialNeed =
  | 'wheelchair'
  | 'vegetarian'
  | 'infant'
  | 'pet_friendly'

type WarningType =
  | 'too_many_places'
  | 'route_backtrack'
  | 'missing_meal'
  | 'far_from_cluster'
  | 'weather_mismatch'
  | 'budget_exceeded'
  | 'physically_demanding'
```

---

## Supabase Schema

```sql
-- Users managed by Supabase Auth

create table itineraries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  data        jsonb not null,        -- full Itinerary object
  is_public   boolean default false, -- for share links
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index on itineraries(user_id);
create index on itineraries(is_public) where is_public = true;
```

---

## Form Input Type

```typescript
// What the landing page form collects before AI generation
interface TripFormInput {
  destination: string
  startDate: string
  endDate: string
  groupSize: number
  groupType: 'solo' | 'couple' | 'friends' | 'family'
  vibes: Vibe[]
  budgetPerDayPerPerson: number
  specialNeeds: SpecialNeed[]
}
```
