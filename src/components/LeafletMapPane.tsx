import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Itinerary } from '../types';
import { allPlaces, placesOfDay, findPlace, sanitiseMapCoord, pickActiveMapDay } from '../lib/itineraryOps';

interface LeafletMapPaneProps {
  itinerary: Itinerary | null;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  darkMode: boolean;
}

const ACCENT_COLOR = '#8E7A5D';
// Standard public OSM tile server — free, no key. Its usage policy asks
// for reasonable (non-bulk) load and visible attribution; a single
// interactive map with a permanent attribution control satisfies both.
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
// OSM's free tiles only come in one (light) style, unlike Amap's
// dark/normal style toggle — this CSS filter fakes a dark map instead of
// pulling in a second, keyed or rate-limited tile provider just for that.
const DARK_TILE_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.85)';
const DEFAULT_CENTER: [number, number] = [20, 0]; // world view until real places arrive
const DEFAULT_ZOOM = 2;

function numberedDivIcon(label: string, selected: boolean): L.DivIcon {
  const size = selected ? 36 : 28;
  return L.divIcon({
    html: `<div style="background:${selected ? ACCENT_COLOR : 'var(--color-surface)'};color:${
      selected ? '#FFF' : 'var(--color-text-main)'
    };border:1px solid var(--color-border);border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.2);">${label}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * International map pane — Leaflet + OpenStreetMap raster tiles, both free
 * and keyless. Routed to by MapPane.tsx for any destination that isn't
 * mainland China; see AmapMapPane.tsx for the China counterpart and
 * MapPane.tsx's module docstring for why the app has two of these instead
 * of one. Mirrors AmapMapPane's behavior (numbered markers, selected-day
 * route line, fit-to-bounds / zoom-to-selection) as closely as the two
 * libraries' APIs allow, sharing sanitiseMapCoord/pickActiveMapDay with it
 * so both engines agree on what counts as a plottable point.
 */
export default function LeafletMapPane({ itinerary, selectedPlaceId, onSelectPlace, darkMode }: LeafletMapPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const polylineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapInstance) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    setMapInstance(map);

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      map.invalidateSize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInstance) return;
    const pane = mapInstance.getPane('tilePane');
    if (pane) pane.style.filter = darkMode ? DARK_TILE_FILTER : '';
  }, [darkMode, mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;

    Object.values(markersRef.current).forEach(m => mapInstance.removeLayer(m));
    markersRef.current = {};
    if (polylineRef.current) {
      mapInstance.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (!itinerary) return;
    const places = allPlaces(itinerary);
    if (places.length === 0) return;

    try {
      const validMarkers: L.Marker[] = [];
      places.forEach((place, idx) => {
        const coord = sanitiseMapCoord(place.coordinates);
        if (!coord) return;
        const isSelected = selectedPlaceId === place.id;

        const marker = L.marker([coord.lat, coord.lng], {
          icon: numberedDivIcon(String(idx + 1), isSelected),
          zIndexOffset: isSelected ? 1000 : idx,
          title: place.name,
        });
        marker.on('click', () => onSelectPlace(place.id));
        marker.addTo(mapInstance);
        markersRef.current[place.id] = marker;
        validMarkers.push(marker);
      });

      const selectedDay = pickActiveMapDay(itinerary, selectedPlaceId);
      if (selectedDay) {
        const dayPath = placesOfDay(selectedDay)
          .map(p => sanitiseMapCoord(p.coordinates))
          .filter((c): c is { lat: number; lng: number } => c !== null);
        if (dayPath.length >= 2) {
          polylineRef.current = L.polyline(
            dayPath.map(c => [c.lat, c.lng] as [number, number]),
            { color: ACCENT_COLOR, opacity: 0.85, weight: 3, dashArray: '6 6', lineJoin: 'round' },
          ).addTo(mapInstance);
        }
      }

      if (selectedPlaceId) {
        const focus = findPlace(itinerary, selectedPlaceId)?.place;
        const focusCoord = focus ? sanitiseMapCoord(focus.coordinates) : null;
        if (focusCoord) {
          mapInstance.setView([focusCoord.lat, focusCoord.lng], 15);
        }
      } else if (validMarkers.length > 0) {
        const bounds = L.latLngBounds(validMarkers.map(m => m.getLatLng()));
        mapInstance.fitBounds(bounds, { padding: [50, 50] });
      }
    } catch (err) {
      console.error('[LeafletMapPane] failed to render markers:', err);
    }
  }, [itinerary, selectedPlaceId, mapInstance, onSelectPlace]);

  return <div ref={containerRef} className="w-full h-full relative" />;
}
