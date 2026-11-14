import React, { useEffect, useRef, useState } from 'react';
import { allPlaces, placesOfDay, findPlace, sanitiseMapCoord } from '../lib/itineraryOps';
import { MARKER_COLORS, type MapPaneProps } from './MapPane';

/**
 * Mainland-China map pane — Amap (高德) JS SDK, real POI-backed. Routed to
 * by MapPane.tsx based on the itinerary's destination; see
 * LeafletMapPane.tsx for the international counterpart and MapPane.tsx's
 * module docstring for why the app has two of these instead of one.
 */
export default function AmapMapPane({ itinerary, activeDay, selectedPlaceId, onSelectPlace }: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const polylineRef = useRef<any>(null);
  const AMap = (window as any).AMap;

  useEffect(() => {
    if (!containerRef.current || !AMap || mapInstance) return;

    const container = containerRef.current;
    let map: any;
    let ro: ResizeObserver | null = null;
    let cancelled = false;

    const tryInit = () => {
      if (cancelled || !containerRef.current) return;
      const { offsetWidth, offsetHeight } = containerRef.current;
      if (offsetWidth === 0 || offsetHeight === 0) {
        // Container not laid out yet — wait one frame and retry.
        requestAnimationFrame(tryInit);
        return;
      }
      map = new AMap.Map(containerRef.current, {
        viewMode: '3D',
        zoom: 11,
        center: [116.397428, 39.90923],
        mapStyle: 'amap://styles/normal',
      });
      setMapInstance(map);

      ro = new ResizeObserver(entries => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) return;
        try {
          if (typeof map.resize === 'function') map.resize();
        } catch {
          // safe to retry on next observation
        }
      });
      ro.observe(container);
    };

    tryInit();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      if (map) map.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInstance || !AMap) return;

    Object.values(markersRef.current).forEach(m => mapInstance.remove(m));
    markersRef.current = {};
    if (polylineRef.current) {
      mapInstance.remove(polylineRef.current);
      polylineRef.current = null;
    }

    if (!itinerary) return;
    const day = activeDay == null ? undefined : itinerary.days.find(d => d.dayNumber === activeDay);
    const places = day ? placesOfDay(day) : allPlaces(itinerary);
    if (places.length === 0) return;

    try {
      const validMarkers: any[] = [];
      places.forEach((place, idx) => {
        const coord = sanitiseMapCoord(place.coordinates);
        if (!coord) return;
        const isSelected = selectedPlaceId === place.id;
        const size = isSelected ? 34 : 28;

        const el = document.createElement('div');
        el.style.background = isSelected ? MARKER_COLORS.selected : MARKER_COLORS.stop;
        el.style.color = '#FFFFFF';
        el.style.border = '2px solid #FFFFFF';
        el.style.borderRadius = '50%';
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontWeight = '600';
        el.style.fontSize = '13px';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
        el.style.transition = 'all 0.2s ease';
        el.style.cursor = 'pointer';
        el.innerText = String(idx + 1);

        const marker = new AMap.Marker({
          position: new AMap.LngLat(coord.lng, coord.lat),
          content: el,
          offset: new AMap.Pixel(-size / 2, -size / 2),
          zIndex: isSelected ? 100 : idx,
          title: place.name,
        });
        marker.on('click', () => onSelectPlace(place.id));
        mapInstance.add(marker);
        markersRef.current[place.id] = marker;
        validMarkers.push(marker);
      });

      if (day) {
        const dayPath = places
          .map(p => sanitiseMapCoord(p.coordinates))
          .filter((c): c is { lat: number; lng: number } => c !== null);
        if (dayPath.length >= 2) {
          const path = dayPath.map(c => new AMap.LngLat(c.lng, c.lat));
          polylineRef.current = new AMap.Polyline({
            path,
            strokeColor: MARKER_COLORS.route,
            strokeOpacity: 0.9,
            strokeWeight: 3,
            strokeStyle: 'dashed',
            lineJoin: 'round',
          });
          mapInstance.add(polylineRef.current);
        }
      }

      const focus = selectedPlaceId ? findPlace(itinerary, selectedPlaceId)?.place : undefined;
      const focusCoord = focus && markersRef.current[focus.id] ? sanitiseMapCoord(focus.coordinates) : null;
      if (focusCoord) {
        mapInstance.setZoomAndCenter(15, [focusCoord.lng, focusCoord.lat], false);
      } else if (validMarkers.length > 0) {
        // setFitView accepts an array of overlays; bounds API differs across versions.
        mapInstance.setFitView(validMarkers, false, [40, 40, 40, 40]);
      }
    } catch (err) {
      console.error('[AmapMapPane] failed to render markers:', err);
    }
  }, [itinerary, activeDay, selectedPlaceId, mapInstance, AMap, onSelectPlace]);

  return <div ref={containerRef} className="w-full h-full relative" />;
}
