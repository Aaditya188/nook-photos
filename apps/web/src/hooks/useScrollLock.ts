/**
 * Body scroll lock for the full-screen viewers (lightbox, shared-album viewer).
 *
 * Two things have to be undone by hand, or the page underneath is wrecked:
 *
 * 1. `overflow: hidden` on the body propagates to the viewport, which collapses
 *    the document's scrollable extent — the browser clamps the scroll offset to
 *    0 and does NOT put it back when the lock lifts. So we save the offset on
 *    lock and restore it on release, from a layout effect, before paint.
 * 2. The vertical scrollbar disappears with it, widening everything inside the
 *    body by its width. PhotoGrid derives its entire layout from the container
 *    width (row packing → chunk heights), so a ~15px swing rebuilds every chunk
 *    on open and again on close. Padding the body by exactly the width the
 *    scrollbar gave up cancels that out, so nothing below it resizes at all.
 *
 * `position: fixed; top: -Ypx` on the body was the alternative: rejected
 * because it collapses the scrollbar the same way (so it needs the padding
 * anyway), reflows the whole document twice, and takes the sticky top bars out
 * of the flow they stick to.
 */
import { useLayoutEffect } from 'react';

const LOCK_CLASS = 'no-scroll';
const GUTTER_VAR = '--scroll-lock-gutter';

// Module state: locks nest (a viewer inside a viewer, or StrictMode's
// setup→cleanup→setup in dev), and only the outermost one owns the offset.
let depth = 0;
let savedX = 0;
let savedY = 0;
const restoreListeners = new Set<() => void>();

/**
 * True while a viewer holds the lock, i.e. while `window.scrollY` is clamped to
 * 0 and says nothing about where the user actually is. Scroll-driven logic
 * should sit still until the lock lifts.
 */
export function isScrollLocked(): boolean {
  return depth > 0;
}

/**
 * Fires right after the lock is released and the scroll offset is restored —
 * synchronously, still inside the releasing layout effect, so subscribers can
 * re-derive what is on screen before the browser paints. The restore does also
 * emit a scroll event, but asynchronously and through a throttle, which is long
 * enough to paint a viewport full of nothing.
 */
export function onScrollRestored(fn: () => void): () => void {
  restoreListeners.add(fn);
  return () => {
    restoreListeners.delete(fn);
  };
}

function acquire() {
  if (depth++ > 0) return;
  savedX = window.scrollX;
  savedY = window.scrollY;
  // Reserve what the scrollbar is about to give up (0 on overlay-scrollbar
  // platforms, and 0 when the page doesn't scroll — nothing to compensate).
  const gutter = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  document.documentElement.style.setProperty(GUTTER_VAR, gutter + 'px');
  document.body.classList.add(LOCK_CLASS);
}

function release() {
  if (depth === 0 || --depth > 0) return;
  document.body.classList.remove(LOCK_CLASS);
  document.documentElement.style.removeProperty(GUTTER_VAR);
  // Undo the clamp. The two-arg form is instant (no scroll-behavior in play),
  // and it clamps itself if the document shrank while the viewer was open.
  window.scrollTo(savedX, savedY);
  for (const fn of restoreListeners) fn();
}

/** Hold the body scroll lock while `locked`, preserving the scroll offset. */
export function useScrollLock(locked: boolean) {
  // Layout effect, not effect: the lock must go on before the frame that shows
  // the viewer, and the offset must be back before the frame that shows the
  // page again — a passive effect restores it one painted frame too late.
  useLayoutEffect(() => {
    if (!locked) return;
    acquire();
    return release;
  }, [locked]);
}
