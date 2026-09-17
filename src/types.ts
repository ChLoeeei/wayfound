// ============================================================
// Wayfound — core data model
// Aligned with PRD §3.2 (Itinerary structure) and §5.3 (Data model)
// ============================================================

// -------- Planning input (form state) -- PRD §3.1 -----------

export type GroupType = 'family' | 'couple' | 'friends' | 'solo';

export type Vibe =
  | 'nature'
  | 'culture'
  | 'food'
  | 'shopping'
  | 'leisure'
  | 'adventure';

export type SpecialNeed =
  | 'accessibility'
  | 'vegetarian'
  | 'baby'           // traveling with a baby
  | 'pet';            // pet friendly

export interface BudgetRange {
  /** lower bound, RMB per person per day */
  min: number;
  /** upper bound, RMB per person per day */
  max: number;
}

export interface PlanningInput {
  destination: string;
  /** ISO date string, YYYY-MM-DD */
  startDate: string;
  /** ISO date string, YYYY-MM-DD */
  endDate: string;
  people: number;
  groupType: GroupType;
  vibes: Vibe[];
  budget: BudgetRange;
  specialNeeds: SpecialNeed[];
  /** Optional clarifications from AI follow-up Q&A */
  clarifications?: Record<string, string>;
}

// -------- AI clarification questions -- PRD §3.1 ------------

export interface ClarificationQuestion {
  /** unique id used as the key in PlanningInput.clarifications */
  id: string;
  /** the question rendered as a chat bubble */
  question: string;
  /** quick-pick suggested answers; user can also type a free-form reply */
  options?: string[];
}

// -------- Itinerary tree -- PRD §3.2 / §5.3 -----------------

export type SlotPeriod = 'morning' | 'afternoon' | 'evening';

export type PlaceType = 'attraction' | 'restaurant' | 'hotel' | 'shopping' | 'cafe' | 'nightlife' | 'leisure';

export interface PlaceCoordinates {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  type: PlaceType;
  coordinates: PlaceCoordinates;
  rating?: number;
  /** RMB per person */
  estimatedCost: number;
  /** suggested stay, minutes */
  duration: number;
  imageUrl?: string;
  /** AI's reason for picking this place */
  aiNote?: string;
  /** Dianping / Google Maps / official site link */
  externalUrl?: string;
  /** Used to look up the place via Amap PlaceSearch (especially for AI-generated entries) */
  searchQuery?: string;
}

export interface TimeSlot {
  period: SlotPeriod;
  places: Place[];
}

export interface Day {
  dayNumber: number;
  /** aesthetic theme, e.g. "Old Town Wandering" */
  theme?: string;
  slots: TimeSlot[];
}

export interface Itinerary {
  id?: string;
  userId?: string;
  title: string;
  summary?: string;
  destination: string;
  startDate: string;
  endDate: string;
  days: Day[];
  createdAt?: string;
  updatedAt?: string;
  /**
   * Human-readable attribution strings for any third-party content used
   * while generating this itinerary — currently only ever
   * "Destination context from Wikivoyage, CC BY-SA 4.0" when the agent's
   * get_destination_context tool was actually called. Computed server-side
   * (server.ts, from the generation's tool-call trace) so the UI doesn't
   * need to know licensing details — see src/components/ItineraryPane.tsx
   * for where this renders.
   */
  sourceAttributions?: string[];
  /**
   * The generation request's id, for fetching its reasoning/tool-call
   * trace from GET /api/trace/:requestId — see
   * src/components/TraceViewer.tsx. Always present on a freshly-generated
   * itinerary; absent on one loaded from a saved/shared record (traces
   * aren't persisted alongside saved itineraries, only ever written
   * per-request server-side).
   */
  requestId?: string;
  /**
   * True when this run's place searches mostly/entirely failed to find
   * anything real (see server/tools/attributions.ts's
   * computeGroundingWarning) — a meaningful share of these places likely
   * came from the model's general knowledge rather than a verified
   * search hit. Renders as a small honesty disclaimer, same spot as
   * sourceAttributions — see src/components/ItineraryPane.tsx. Absent
   * (not just false) when there's nothing to warn about.
   */
  groundingWarning?: boolean;
}

// -------- Map integration helpers ---------------------------

export interface AmapPlaceData {
  id?: string;
  location?: PlaceCoordinates;
  photoUrl?: string;
  rating?: number;
  name?: string;
  address?: string;
}
