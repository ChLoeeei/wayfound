/**
 * Browser side of photo input (v2 feature D): accept a JPEG / PNG / WebP
 * up to MAX_UPLOAD_BYTES, redraw it on a canvas at ≤ MAX_EDGE px and send
 * the result as a JPEG data URL. Redrawing drops every metadata segment
 * (EXIF, GPS) before the image leaves the device; the server strips again.
 */
import type { Place, SlotPeriod } from '../types';
import type { PhotoCandidate, IdentifyResult } from './photoTypes';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_EDGE = 1600;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PhotoError = 'type' | 'size' | 'decode';

export function validatePhotoFile(file: Pick<File, 'type' | 'size'>): PhotoError | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'type';
  if (file.size > MAX_UPLOAD_BYTES) return 'size';
  return null;
}

/** Target size that keeps the aspect ratio with the longer edge at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decodes, downscales and re-encodes the file as a JPEG data URL (no metadata). */
export async function prepareImage(file: File): Promise<string> {
  const problem = validatePhotoFile(file);
  if (problem) throw new Error(problem);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('decode');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function identifyPhotoRequest(image: string, destination: string, language: string): Promise<IdentifyResult> {
  const res = await fetch(`${process.env.API_BASE_URL}/api/identify-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, destination, language }),
  });
  const data = (await res.json()) as IdentifyResult & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const TYPE_HINTS: Array<[RegExp, Place['type']]> = [
  [/餐饮|restaurant|food|dining|bar|pub/i, 'restaurant'],
  [/咖啡|cafe|coffee|tea|bakery|dessert/i, 'cafe'],
  [/住宿|酒店|hotel|hostel|accommodation/i, 'hotel'],
  [/购物|商场|shop|mall|market|store/i, 'shopping'],
  [/夜生活|nightlife|club|izakaya/i, 'nightlife'],
  [/休闲|park|garden|leisure|beach|spa/i, 'leisure'],
];

/** Map a provider's type string to our place types. Used by the search modal and the photo card. */
export function inferPlaceType(providerType: string, fallback: Place['type'] = 'attraction'): Place['type'] {
  for (const [re, type] of TYPE_HINTS) if (re.test(providerType)) return type;
  return fallback;
}

/** A verified candidate becomes a grounded stop; `poiId` keeps the provenance. */
export function placeFromCandidate(c: PhotoCandidate, typeHint?: string): Place {
  return {
    id: `photo-${c.id.slice(-10)}-${Math.random().toString(36).slice(2, 7)}`,
    name: c.name,
    type: inferPlaceType(c.type, typeHint && ['attraction', 'restaurant', 'hotel', 'shopping', 'cafe', 'nightlife', 'leisure'].includes(typeHint) ? (typeHint as Place['type']) : 'attraction'),
    coordinates: { lat: c.lat, lng: c.lng },
    ...(c.rating != null ? { rating: c.rating } : {}),
    estimatedCost: 0,
    duration: 90,
    ...(c.photoUrl ? { imageUrl: c.photoUrl } : {}),
    aiNote: '',
    searchQuery: c.name,
    poiId: c.id,
  };
}

export type { PhotoCandidate, IdentifyResult, SlotPeriod };
