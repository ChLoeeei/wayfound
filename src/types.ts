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

export type ClarificationId = 'primaryVibe' | 'kidsOnBoard' | 'budgetLean' | 'multiCity' | 'destinationFocus';

export interface ClarificationQuestion {
  /** unique id used as the key in PlanningInput.clarifications; also the locale key `clarify.<id>.question` */
  id: ClarificationId;
  /** values interpolated into the question text, e.g. the budget bounds */
  params?: Record<string, string | number>;
  /**
   * quick-pick answer keys (`clarify.<id>.options.<key>`, or vibe keys for
   * primaryVibe); the user can also type a free-form reply. The rendered
   * text, not the key, is what gets stored as the answer.
   */
  options?: string[];
}

/** UI language; also sent with a generation request so the agent writes its prose in it. */
export type UiLanguage = 'en' | 'zh';

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
  /** Set by the agent when the place matched no map-search result, even after a re-search: treat coordinates as approximate. */
  unverified?: boolean;
  // ---- v2 structured fields (server/structure.ts), all estimates except slotId / poiId / locked ----
  /** Stable id of the time slot this place occupies; survives edits and replanning. */
  slotId?: string;
  /** Estimated start, HH:MM, packed from the period window and durations. Shown as approximate. */
  start?: string;
  /** Estimated end, HH:MM. Shown as approximate. */
  end?: string;
  /** Provider POI id when the place matched a search result of the run that produced it. */
  poiId?: string;
  /** The user asked to keep this stop; partial replanning refuses targets that include it. */
  locked?: boolean;
  /** Estimated travel from the previous stop of the same day; absent on the first stop. */
  travelFromPrev?: TravelEstimate;
}

/** Straight-line estimate between consecutive stops; never a routed, exact figure. */
export interface TravelEstimate {
  mode: 'walk' | 'transit' | 'drive';
  minutes: number;
  distanceM: number;
  estimated: true;
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
  /** Bumped by every applied edit or replanning; the client keeps earlier versions for undo. */
  version?: number;
  /**
   * Experience-library lesson ids injected into this plan's prompt (v2
   * Core 2); empty when the library was off. Set by server.ts.
   */
  usedLessonIds?: string[];
  /** Version of the library those lessons came from. */
  libraryVersion?: number;
  /**
   * Names of places that matched no search_places result this run, by the
   * eval's own rule (server/grounding.ts). Duplicates kept, itinerary order.
   */
  ungroundedPlaceNames?: string[];
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
