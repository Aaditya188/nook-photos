/**
 * Map view — every GPS-tagged photo on a world map. Clusters are computed
 * in-house: photos are binned in screen space (~56px cells) on every
 * move/zoom, each cluster rendered as a cover-photo pin with a count badge
 * (Google-Photos style). Clicking a cluster zooms in; a single photo opens
 * the viewer. Tiles: OSM (light) / Carto dark-matter (dark), picked by theme.
 */
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PhotoRecord } from '@nook/core';
import { useAuth } from '../state/auth';
import { useLibraryQ } from '../state/data';
import { useRegisterList, useView } from '../state/view';
import { ViewHead, EmptyState } from '../components/chrome';
import { fmtCount } from '../lib/format';

interface GeoPhoto {
  p: PhotoRecord;
  lat: number;
  lon: number;
}

export function MapView() {
  const libQ = useLibraryQ();
  const { mediaUrl } = useAuth();
  const { openLightbox } = useView();

  const geo = useMemo<GeoPhoto[]>(
    () =>
      (libQ.data || [])
        .filter((p) => {
          if (p.hidden || p.latitude == null || p.longitude == null) return false;
          const lat = p.latitude;
          const lon = p.longitude;
          // Junk EXIF guards: null island and out-of-range values would
          // stretch the initial bounds to the whole world.
          if (Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01) return false;
          return lat >= -85 && lat <= 85 && lon >= -180 && lon <= 180;
        })
        .map((p) => ({ p, lat: p.latitude!, lon: p.longitude! })),
    [libQ.data],
  );
  useRegisterList(useMemo(() => geo.map((g) => g.p), [geo]));

  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const openRef = useRef(openLightbox);
  openRef.current = openLightbox;
  const mediaRef = useRef(mediaUrl);
  mediaRef.current = mediaUrl;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const map = L.map(host, { zoomControl: true, attributionControl: true });
    L.tileLayer(
      dark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: dark
          ? '&copy; OpenStreetMap &copy; CARTO'
          : '&copy; OpenStreetMap contributors',
      },
    ).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;

    const CELL = 56; // px cluster cell

    const render = () => {
      const g = geoRef.current;
      layer.clearLayers();
      if (g.length === 0) return;
      const zoom = map.getZoom();
      const bounds = map.getBounds().pad(0.3);
      // Bin visible photos by screen-space cell.
      const bins = new Map<string, GeoPhoto[]>();
      for (const item of g) {
        if (!bounds.contains([item.lat, item.lon])) continue;
        const pt = map.project([item.lat, item.lon], zoom);
        const key = Math.round(pt.x / CELL) + ':' + Math.round(pt.y / CELL);
        const arr = bins.get(key);
        if (arr) arr.push(item);
        else bins.set(key, [item]);
      }
      for (const items of bins.values()) {
        const lat = items.reduce((s, i) => s + i.lat, 0) / items.length;
        const lon = items.reduce((s, i) => s + i.lon, 0) / items.length;
        const cover = items[0].p;
        const count = items.length;
        const thumb = mediaRef.current(cover.thumbUrl + '?w=128');
        const icon = L.divIcon({
          className: 'map-pin-wrap',
          html:
            '<div class="map-pin"><img src="' +
            thumb.replace(/"/g, '&quot;') +
            '" alt="" />' +
            (count > 1 ? '<span class="map-pin-count">' + (count > 99 ? '99+' : count) + '</span>' : '') +
            '</div>',
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
        const marker = L.marker([lat, lon], { icon });
        marker.on('click', () => {
          if (count === 1 || map.getZoom() >= 17) {
            openRef.current(cover.id);
          } else {
            map.setView([lat, lon], Math.min(17, map.getZoom() + 3), { animate: true });
          }
        });
        marker.addTo(layer);
      }
    };

    map.on('moveend zoomend', render);

    // Initial view: fit all geo photos.
    const g = geoRef.current;
    if (g.length > 0) {
      map.fitBounds(L.latLngBounds(g.map((i) => [i.lat, i.lon] as [number, number])), {
        padding: [40, 40],
        maxZoom: 12,
      });
    } else {
      map.setView([20, 0], 2);
    }
    render();

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render markers when the library changes (map already mounted).
  useEffect(() => {
    mapRef.current?.fire('moveend');
  }, [geo]);

  return (
    <>
      <ViewHead title="Map" subtitle={geo.length ? fmtCount(geo.length) : ''} />
      <div id="grid">
        {libQ.isSuccess && geo.length === 0 ? (
          <EmptyState kind="places" />
        ) : (
          <div ref={hostRef} className="map-host" />
        )}
      </div>
    </>
  );
}
