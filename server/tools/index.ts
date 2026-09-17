import OpenAI from 'openai';
import * as amap from './amap';
import * as mapbox from './mapbox';
import * as wikivoyage from './wikivoyage';
import { getMapProvider, parseLngLat, type MapProvider, type Poi } from './provider';

/**
 * Tool registry for the DeepSeek planning agent.
 * Each tool has:
 *   - definition: the OpenAI function-calling schema sent to the model
 *   - run: server-side handler that executes the call and returns a JSON-stringifiable result
 *
 * search_places / get_poi_details / calculate_distance are provider-routed:
 * ToolContext resolves mainland-China vs. international once per
 * generateItinerary() run (from the request's destination) and runTool()
 * branches on it. Both providers return the same normalized `Poi` shape
 * (see ./provider), so nothing downstream of runTool() needs to know or
 * care which one actually served a given call.
 *
 * get_destination_context is NOT provider-routed — Wikivoyage covers any
 * destination regardless of geography, so it's a single unconditional case
 * in runTool() below. Its content is CC BY-SA 4.0 — see wikivoyage.ts's
 * module docstring for the UI attribution wiring this depends on
 * (server.ts computes sourceAttributions from the trace of this call;
 * removing this tool without also removing that wiring would leave a dead
 * code path, not a licensing problem, but keep them in sync).
 */

export type ToolName = 'search_places' | 'get_poi_details' | 'calculate_distance' | 'get_destination_context';

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_places',
      description:
        'Search for POIs (attractions, restaurants, hotels, shops) by keywords. Automatically routes to the right map provider for the destination — Amap for mainland China, Mapbox internationally — so this works globally. Use Chinese names for places inside mainland China, local/English names elsewhere. Returns up to 10 candidates.',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: 'Free-form keywords, e.g. "外滩" or "Eiffel Tower". Required. Do not append the city name here — pass it via `region` instead.',
          },
          region: {
            type: 'string',
            description: 'City name to scope the search, e.g. "上海" or "Paris".',
          },
          limit: {
            type: 'number',
            description: 'Max results, 1-25 (mainland China) or 1-10 (international). Defaults to 10.',
          },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_poi_details',
      description:
        'Fetch richer detail for a single POI by id (as returned by search_places). Rating and photos are only reliably available for mainland-China (Amap) POIs — international (Mapbox) POIs will have those fields empty.',
      parameters: {
        type: 'object',
        properties: {
          poiId: { type: 'string', description: 'POI id, as returned by search_places' },
        },
        required: ['poiId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_distance',
      description:
        'Compute driving distance and time between two POIs. Use to validate route logic and avoid back-and-forth.',
      parameters: {
        type: 'object',
        properties: {
          originPoiId: { type: 'string', description: 'POI id of the starting point' },
          destinationPoiId: { type: 'string', description: 'POI id of the destination' },
        },
        required: ['originPoiId', 'destinationPoiId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_destination_context',
      description:
        'Fetch a short Wikivoyage travel-guide extract for a destination. Use this to ground aiNote / "why visit" / practical-tips text in real content instead of relying purely on general knowledge — not for finding specific POI coordinates, use search_places for that. Optional but recommended once per destination. Returns null if no matching article exists (not an error — just fall back to general knowledge for that destination).',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'City or region name, e.g. "Kyoto" or "Paris". Required.' },
          topic: {
            type: 'string',
            description: 'Optional topic to bias the lookup toward, e.g. "food" or "history". Best-effort — Wikivoyage may not have a dedicated section for every topic.',
          },
        },
        required: ['destination'],
      },
    },
  },
];

export interface SerializablePoi {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  type: string;
  rating?: number;
  photoUrl?: string;
}

function proxyAmapImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/(?:^|\.)(autonavi|amap)\.com/.test(url)) {
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function poiToSerializable(p: Poi): SerializablePoi | null {
  const coord = parseLngLat(p.location);
  if (!coord) return null;
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    lat: coord.lat,
    lng: coord.lng,
    type: p.type,
    rating: p.rating,
    // No-op for Mapbox POIs (photoUrl is always undefined there) — only
    // rewrites Amap CDN URLs, which lack CORS headers.
    photoUrl: proxyAmapImageUrl(p.photoUrl),
  };
}

/**
 * Per-run state for the planning agent's tool calls:
 *   - `provider` is resolved once, from the request's destination, and
 *     reused for every search_places / get_poi_details / calculate_distance
 *     call in this run — a single itinerary is always one destination, so
 *     there's no per-call provider ambiguity to resolve.
 *   - `poiCache` lets get_poi_details / calculate_distance resolve a POI by
 *     id without re-searching. Keyed on POI id (Amap or Mapbox — the two
 *     id formats never collide in practice).
 */
export class ToolContext {
  readonly provider: MapProvider;
  private poiCache = new Map<string, Poi>();

  constructor(destination: string) {
    this.provider = getMapProvider(destination);
  }

  rememberPois(pois: Poi[]) {
    for (const p of pois) this.poiCache.set(p.id, p);
  }

  getPoi(id: string): Poi | undefined {
    return this.poiCache.get(id);
  }
}

export async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, any>,
): Promise<unknown> {
  const client = ctx.provider === 'amap' ? amap : mapbox;
  switch (name) {
    case 'search_places': {
      const { keywords, region, limit } = args;
      const result = await client.searchPlaces(String(keywords ?? ''), region, Number(limit) || 10);
      ctx.rememberPois(result.pois);
      return {
        count: result.count,
        results: result.pois.map(poiToSerializable).filter(Boolean),
      };
    }
    case 'get_poi_details': {
      const { poiId } = args;
      const cached = ctx.getPoi(String(poiId));
      const poi = cached ?? (await client.getPoiDetails(String(poiId)));
      if (poi) ctx.rememberPois([poi]);
      return poi ? poiToSerializable(poi) : null;
    }
    case 'calculate_distance': {
      const origin = ctx.getPoi(String(args.originPoiId));
      const dest = ctx.getPoi(String(args.destinationPoiId));
      if (!origin || !dest) {
        return { error: 'Unknown POI id. Call search_places first.' };
      }
      const oc = parseLngLat(origin.location);
      const dc = parseLngLat(dest.location);
      if (!oc || !dc) return { error: 'Invalid coordinates on cached POI.' };
      const r = await client.calculateDistance(oc, dc);
      return r;
    }
    case 'get_destination_context': {
      const { destination, topic } = args;
      const result = await wikivoyage.getDestinationContext(String(destination ?? ''), topic ? String(topic) : undefined);
      return result ?? { error: 'No Wikivoyage article found for this destination.' };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
