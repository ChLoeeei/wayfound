/** Shapes returned by POST /api/identify-photo (server/photo.ts). */
export interface PhotoCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  type: string;
  rating?: number;
  photoUrl?: string;
  exact: boolean;
}

export interface VisionResult {
  name: string;
  city: string;
  placeType: string;
  visibleText: string;
  confidence: number;
}

export interface IdentifyResult {
  identified: VisionResult | null;
  candidates: PhotoCandidate[];
  confident: boolean;
  searchedIn?: string;
}

export interface PhotoState {
  status: 'preparing' | 'identifying' | 'ready' | 'failed';
  /** Local preview (object URL or data URL). */
  preview?: string;
  result?: IdentifyResult;
  error?: string;
}
