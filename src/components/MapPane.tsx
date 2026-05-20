import React, { useEffect, useRef, useState } from 'react';
import type { Itinerary, Place } from '../types';
import { allPlaces, placesOfDay, findPlace } from '../lib/itineraryOps';

interface MapPaneProps {
  itinerary: Itinerary | null;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string) => void;
  darkMode: boolean;
}

const ACCENT_COLOR = '#8E7A5D';

export default function MapPane({ itinerary, selectedPlaceId, onSelectPlace, darkMode }: MapPaneProps) {
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
        mapStyle: darkMode ? 'amap://styles/dark' : 'amap://styles/normal',
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
    if (mapInstance) {
      mapInstance.setMapStyle(darkMode ? 'amap://styles/dark' : 'amap://styles/normal');
    }
  }, [darkMode, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !AMap) return;

    Object.values(markersRef.current).forEach(m => mapInstance.remove(m));
    markersRef.current = {};
    if (polylineRef.current) {
      mapInstance.remove(polylineRef.current);
      polylineRef.current = null;
    }

    if (!itinerary) return;

    const places = allPlaces(itinerary);
    if (places.length === 0) return;

    try {
      const validMarkers: any[] = [];
      places.forEach((place, idx) => {
        const coord = sanitiseCoord(place.coordinates);
        if (!coord) return;
        const isSelected = selectedPlaceId === place.id;

        const el = document.createElement('div');
        el.style.background = isSelected ? ACCENT_COLOR : 'var(--color-surface)';
        el.style.color = isSelected ? '#FFF' : 'var(--color-text-main)';
        el.style.border = '1px solid var(--color-border)';
        el.style.borderRadius = '50%';
        el.style.width = isSelected ? '36px' : '28px';
        el.style.height = isSelected ? '36px' : '28px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontWeight = 'bold';
        el.style.fontSize = '12px';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
        el.style.transition = 'all 0.2s ease';
        el.style.cursor = 'pointer';
        el.innerText = String(idx + 1);

        const marker = new AMap.Marker({
          position: new AMap.LngLat(coord.lng, coord.lat),
          content: el,
          offset: new AMap.Pixel(isSelected ? -18 : -14, isSelected ? -18 : -14),
          zIndex: isSelected ? 100 : idx,
          title: place.name,
        });
        marker.on('click', () => onSelectPlace(place.id));
        mapInstance.add(marker);
        markersRef.current[place.id] = marker;
        validMarkers.push(marker);
      });

      const selectedDay = pickActiveDay(itinerary, selectedPlaceId);
      if (selectedDay) {
        const dayPath = placesOfDay(selectedDay)
          .map(p => sanitiseCoord(p.coordinates))
          .filter((c): c is { lat: number; lng: number } => c !== null);
        if (dayPath.length >= 2) {
          const path = dayPath.map(c => new AMap.LngLat(c.lng, c.lat));
          polylineRef.current = new AMap.Polyline({
            path,
            strokeColor: ACCENT_COLOR,
            strokeOpacity: 0.85,
            strokeWeight: 3,
            strokeStyle: 'dashed',
            lineJoin: 'round',
          });
          mapInstance.add(polylineRef.current);
        }
      }

      if (selectedPlaceId) {
        const focus = findPlace(itinerary, selectedPlaceId)?.place;
        const focusCoord = focus ? sanitiseCoord(focus.coordinates) : null;
        if (focusCoord) {
          mapInstance.setZoomAndCenter(15, [focusCoord.lng, focusCoord.lat], false);
        }
      } else if (validMarkers.length > 0) {
        // setFitView accepts an array of overlays; bounds API differs across versions.
        mapInstance.setFitView(validMarkers, false, [50, 50, 50, 50]);
      }
    } catch (err) {
      console.error('[MapPane] failed to render markers:', err);
    }
  }, [itinerary, selectedPlaceId, mapInstance, AMap, onSelectPlace]);

  return <div ref={containerRef} className="w-full h-full relative" />;
}

function sanitiseCoord(c: Place['coordinates'] | undefined): { lat: number; lng: number } | null {
  if (!c) return null;
  const lat = typeof c.lat === 'number' ? c.lat : parseFloat(String(c.lat));
  const lng = typeof c.lng === 'number' ? c.lng : parseFloat(String(c.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function pickActiveDay(itinerary: Itinerary, selectedPlaceId: string | null) {
  if (selectedPlaceId) {
    const found = findPlace(itinerary, selectedPlaceId);
    if (found) return found.day;
  }
  return itinerary.days[0] ?? null;
}
