import OpenAI from 'openai';
import {
  searchPlaces,
  getPoiDetails,
  calculateDistance,
  parseLngLat,
  type AmapPoi,
} from './amap';

/**
 * Tool registry for the DeepSeek planning agent.
 * Each tool has:
 *   - definition: the OpenAI function-calling schema sent to the model
 *   - run: server-side handler that executes the call and returns a JSON-stringifiable result
 */

export type ToolName = 'search_places' | 'get_poi_details' | 'calculate_distance';

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_places',
      description:
        'Search Amap POIs (attractions, restaurants, hotels, shops) by keywords. Use Chinese names for places inside China. Returns up to 10 candidates.',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: 'Free-form keywords, e.g. "外滩" or "京都拉面". Required.',
          },
          region: {
            type: 'string',
            description: 'City name or adcode to scope the search, e.g. "上海" or "010".',
          },
          limit: {
            type: 'number',
            description: 'Max results, 1-25. Defaults to 10.',
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
      description: 'Fetch richer detail (rating, photos, address) for a single Amap POI by id.',
      parameters: {
        type: 'object',
        properties: {
          poiId: { type: 'string', description: 'Amap POI id' },
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
          originPoiId: { type: 'string', description: 'Amap POI id of the starting point' },
          destinationPoiId: { type: 'string', description: 'Amap POI id of the destination' },
        },
        required: ['originPoiId', 'destinationPoiId'],
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

function poiToSerializable(p: AmapPoi): SerializablePoi | null {
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
    photoUrl: proxyAmapImageUrl(p.photoUrl),
  };
}

/**
 * In-process cache so the agent can call get_poi_details / calculate_distance
 * by id without re-searching. Keyed on Amap POI id.
 */
export class ToolContext {
  private poiCache = new Map<string, AmapPoi>();

  rememberPois(pois: AmapPoi[]) {
    for (const p of pois) this.poiCache.set(p.id, p);
  }

  getPoi(id: string): AmapPoi | undefined {
    return this.poiCache.get(id);
  }
}

export async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, any>,
): Promise<unknown> {
  switch (name) {
    case 'search_places': {
      const { keywords, region, limit } = args;
      const result = await searchPlaces(String(keywords ?? ''), region, Number(limit) || 10);
      ctx.rememberPois(result.pois);
      return {
        count: result.count,
        results: result.pois.map(poiToSerializable).filter(Boolean),
      };
    }
    case 'get_poi_details': {
      const { poiId } = args;
      const cached = ctx.getPoi(String(poiId));
      const poi = cached ?? (await getPoiDetails(String(poiId)));
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
      const r = await calculateDistance(oc, dc);
      return r;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
