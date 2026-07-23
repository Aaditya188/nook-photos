/**
 * SVG icon set, carried over verbatim from the vanilla dashboard so the design
 * stays pixel-identical. Icons are raw SVG strings rendered through <Svg/>;
 * keeping them as strings (not JSX) means diffs against the original UI are
 * trivial and the markup can't drift.
 */

export const ICON: Record<string, string> = {
  library: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4.5" width="18" height="15" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="9.5" r="1.6" fill="currentColor"/><path d="M4 16.5l4.5-4 3 2.6 3.5-3.6 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9C.4 8.6 2 4.5 5.8 4.5c2.1 0 3.4 1.3 4.2 2.4C10.8 5.8 12.1 4.5 14.2 4.5 18 4.5 19.6 8.6 18 12c-2.5 4.4-6 9-6 9z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor"/></svg>',
  screenshot: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 6.5a8 8 0 0 0 0 11M17.5 6.5a8 8 0 0 1 0 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pano: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 6.5c6-1.5 12-1.5 18 0v11c-6-1.5-12-1.5-18 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 13l2.5-3 2 2.2L15 9l3 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  portrait: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3.5" width="14" height="17" rx="3" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.7"/><path d="M8 17c.7-1.8 2.2-2.6 4-2.6s3.3.8 4 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6S13.9 16 14.5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 5.2A3 3 0 0 1 16 11M17.5 14.6c2 .5 3.4 2 3.9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  places: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 21c4-4.3 6.5-7.6 6.5-11a6.5 6.5 0 1 0-13 0c0 3.4 2.5 6.7 6.5 11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" stroke="currentColor" stroke-width="1.7"/></svg>',
  albums: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>',
  hidden: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.5 6.3A9.6 9.6 0 0 1 12 6.2c5 0 8.5 5.8 8.5 5.8a15 15 0 0 1-2.4 3M6.1 7.9A15.5 15.5 0 0 0 3.5 12s3.5 5.8 8.5 5.8c1.2 0 2.3-.3 3.3-.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M7 7l.8 11a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8.5" r="3.6" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c.8-3.7 3.7-5.7 7.5-5.7s6.7 2 7.5 5.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6S13.9 16 14.5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 5.2A3 3 0 0 1 16 11M17.5 14.6c2 .5 3.4 2 3.9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

export const SVG_HEART_FILL =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9C.4 8.6 2 4.5 5.8 4.5c2.1 0 3.4 1.3 4.2 2.4C10.8 5.8 12.1 4.5 14.2 4.5 18 4.5 19.6 8.6 18 12c-2.5 4.4-6 9-6 9z"/></svg>';

export const SVG_HEART_OUTLINE =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.5s-7-4.3-9.3-8.4C1.2 9.2 2.6 5.5 6 5.5c1.9 0 3.1 1.2 3.8 2.2C10.5 6.7 11.7 5.5 13.6 5.5c3.4 0 4.8 3.7 3.3 6.6-2.3 4.1-8.9 8.4-8.9 8.4z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_CHECK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_CLOCK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_DOWNLOAD =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_RESTORE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v3.5h3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_ADD_ALBUM =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M19 9v9.5A2.5 2.5 0 0 1 16.5 21H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const SVG_PLUS =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export const SVG_EYE =
  '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.8"/></svg>';

export const SVG_BACK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_SET_COVER =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M4 16l4.5-4 3 2.5 3.5-3.5 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const SVG_REMOVE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 12h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

export const SVG_ADD_TO_ALBUM_PLUS =
  '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M19 9v9.5A2.5 2.5 0 0 1 16.5 21H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 11.5h4M11.5 9.5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const SVG_LOCK =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="15.2" r="1.4" fill="currentColor"/></svg>';

export const THEME_ICONS: Record<string, string> = {
  dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.2M12 18.8V21M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M3 12h2.2M18.8 12H21M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 16.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

/** Render one of the raw SVG strings above inside a span (or given tag). */
export function Svg({
  html,
  className,
  title,
}: {
  html: string;
  className?: string;
  title?: string;
}) {
  return <span className={className} title={title} dangerouslySetInnerHTML={{ __html: html }} />;
}
