/**
 * Measure the pinned bars into --topbar-h / --toolbar-h so the sticky
 * search/view-head stack has exact offsets.
 */
import { useEffect, useLayoutEffect } from 'react';

export function syncStickyHeights() {
  const tb = document.querySelector('.topbar') as HTMLElement | null;
  const tl = document.querySelector('.content .toolbar') as HTMLElement | null;
  const root = document.documentElement.style;
  if (tb) root.setProperty('--topbar-h', tb.offsetHeight + 'px');
  // Always write --toolbar-h: on toolbar-less pages (Settings, Backup, Map…) it
  // must reset to 0, or the sticky .view-head keeps a stale offset from the last
  // page and paints its opaque background over the first row of content.
  root.setProperty('--toolbar-h', tl ? tl.offsetHeight + 'px' : '0px');
}

export function useStickyHeights(dep?: unknown) {
  // Re-measure after every navigation (before paint): the toolbar appears on
  // library pages and vanishes on Settings/Backup/…, so --toolbar-h must be
  // recomputed or the sticky view-head keeps a stale offset from the last route.
  useLayoutEffect(() => {
    syncStickyHeights();
  }, [dep]);

  useEffect(() => {
    syncStickyHeights();
    window.addEventListener('load', syncStickyHeights);
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(syncStickyHeights, 150);
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('load', syncStickyHeights);
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, []);
}
