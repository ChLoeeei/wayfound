import React from 'react';
import type { Itinerary } from '../types';
import { getMapProvider } from '../../server/tools/provider';
import AmapMapPane from './AmapMapPane';
import LeafletMapPane from './LeafletMapPane';

export interface MapPaneProps {
  itinerary: Itinerary | null;
  /** Day whose stops and route are drawn (numbered within the day); null draws every day. */
  activeDay: number | null;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  /** Stops the last edit changed: drawn in amber (feature C). */
  changedPlaceIds?: string[];
}

/** Marker colours, from the design reference: ink for a stop, accent for the selected one. */
export const MARKER_COLORS = { stop: '#16181D', selected: '#0F6E66', route: '#0F6E66', changed: '#B4570F' } as const;

/**
 * Routes to the right map engine for the itinerary's destination — the
 * backend already does this for POI/route data (server/tools/provider.ts's
 * getMapProvider, shared by amap.ts vs. mapbox.ts/geoapify.ts), but the map
 * *rendering* component never got the same treatment: it always rendered
 * the Amap JS SDK regardless of destination, so an international trip
 * (e.g. Tokyo) showed Chinese labels and the AutoNavi watermark on a map
 * of Japan. Fixed by importing the SAME getMapProvider() used server-side
 * (pure logic, no Node-only APIs, safe to bundle into the client) rather
 * than duplicating the mainland-China heuristic a second time.
 *
 * `key={provider}` forces a full unmount/remount when the provider
 * changes (e.g. editing a China trip into an international one mid-
 * session) instead of trying to reuse refs/DOM across two unrelated map
 * libraries, which is simpler and safer than migrating one map instance
 * from one engine to the other in place.
 */
export default function MapPane(props: MapPaneProps) {
  const provider = props.itinerary ? getMapProvider(props.itinerary.destination) : 'amap';

  if (provider === 'amap') {
    return <AmapMapPane key="amap" {...props} />;
  }

  return <LeafletMapPane key="leaflet" {...props} />;
}
