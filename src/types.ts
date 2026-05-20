// ============================================================
// Wayfound — core data model
// Aligned with PRD §3.2 (Itinerary structure) and §5.3 (Data model)
// ============================================================

// -------- Planning input (form state) -- PRD §3.1 -----------

export type GroupType = 'family' | 'couple' | 'friends' | 'solo';

export type Vibe =
  | 'nature'      // 自然
  | 'culture'     // 人文
  | 'food'        // 美食
  | 'shopping'    // 购物
  | 'leisure'     // 休闲
  | 'adventure';  // 探险

export type SpecialNeed =
  | 'accessibility' // 无障碍
  | 'vegetarian'    // 素食
  | 'baby'          // 带婴儿
  | 'pet';          // 宠物友好

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
