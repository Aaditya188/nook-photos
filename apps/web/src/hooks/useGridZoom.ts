/**
 * Grid density zoom: pinch (trackpad pinch = wheel+ctrlKey; touch pinch below)
 * or Ctrl+scroll over the photo grid steps the tile size. Persisted. Only
 * active while a photo grid is on screen so browser page-zoom still works
 * elsewhere.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export const GRID_ZOOM_LEVELS = [110, 140, 180, 230, 290, 360];

const listeners = new Set<() => void>();

export function gridZoomIndex(): number {
  const i = parseInt(localStorage.getItem('nookGridZoom') || '', 10);
  return Number.isInteger(i) ? Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, i)) : 2;
}

export function applyGridZoom() {
  document.documentElement.style.setProperty(
    '--tile-min',
    GRID_ZOOM_LEVELS[gridZoomIndex()] + 'px',
  );
}

export function setGridZoom(next: number) {
  const clamped = Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, next));
  if (clamped === gridZoomIndex()) return;
  localStorage.setItem('nookGridZoom', String(clamped));
  applyGridZoom();
  listeners.forEach((l) => l());
}

/** Reactive zoom index (drives thumb-size buckets + grid relayout). */
export function useGridZoomIndex(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    gridZoomIndex,
  );
}

/** Attach wheel/pinch zoom handlers to the content element. */
export function useGridZoomGestures(contentRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    applyGridZoom();
    const content = contentRef.current;
    if (!content) return;

    let wheelAccum = 0;
    const hasGrid = () => !!content.querySelector('.jrow, .day-grid');

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch reports ctrlKey
      if (!hasGrid()) return;
      e.preventDefault(); // keep the browser from page-zooming over the grid
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < 25) return;
      const zoomIn = wheelAccum < 0;
      wheelAccum = 0;
      setGridZoom(gridZoomIndex() + (zoomIn ? 1 : -1));
    };

    let pinchStartDist = 0;
    let pinchStartIdx = 0;
    const touchDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && hasGrid()) {
        pinchStartDist = touchDist(e.touches);
        pinchStartIdx = gridZoomIndex();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchStartDist || !hasGrid()) return;
      e.preventDefault();
      const steps = Math.round(Math.log2(touchDist(e.touches) / pinchStartDist) * 2);
      setGridZoom(pinchStartIdx + steps);
    };
    const onTouchEnd = () => {
      pinchStartDist = 0;
    };

    content.addEventListener('wheel', onWheel, { passive: false });
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: false });
    content.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      content.removeEventListener('wheel', onWheel);
      content.removeEventListener('touchstart', onTouchStart);
      content.removeEventListener('touchmove', onTouchMove);
      content.removeEventListener('touchend', onTouchEnd);
    };
  }, [contentRef]);
}

/**
 * Density-aware thumbnail width: the smallest server bucket that covers the
 * current tile size at this screen's pixel ratio.
 */
const THUMB_BUCKETS = [128, 192, 256, 384, 512];

export function gridThumbW(): number {
  const px = GRID_ZOOM_LEVELS[gridZoomIndex()] * Math.min(window.devicePixelRatio || 1, 2);
  for (const b of THUMB_BUCKETS) if (b >= px) return b;
  return THUMB_BUCKETS[THUMB_BUCKETS.length - 1];
}

export const useGridZoom = { GRID_ZOOM_LEVELS };
