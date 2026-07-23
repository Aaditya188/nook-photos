/**
 * Measure the pinned bars into --topbar-h / --toolbar-h so the sticky
 * search/view-head stack has exact offsets.
 */
import { useEffect } from 'react';

export function syncStickyHeights() {
  const tb = document.querySelector('.topbar') as HTMLElement | null;
  const tl = document.querySelector('.content .toolbar') as HTMLElement | null;
  const root = document.documentElement.style;
  if (tb) root.setProperty('--topbar-h', tb.offsetHeight + 'px');
  if (tl) root.setProperty('--toolbar-h', tl.offsetHeight + 'px');
}

export function useStickyHeights() {
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
