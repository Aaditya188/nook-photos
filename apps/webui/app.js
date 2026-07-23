/*
 * Nook Photos dashboard — vanilla ES module, no frameworks, no imports.
 * Talks to the Nook server API v2 (accounts; see docs/API.md).
 *
 * Auth is per-user with bearer tokens. On load we look for a saved token
 * (localStorage.nookToken); if it's missing or invalid we show a login /
 * first-run setup card. Every /api/* request carries an
 * `Authorization: Bearer <token>` header — including image loads, which is
 * why thumbnails/originals are fetched as authed blobs turned into object
 * URLs (an <img src> can't send headers). Any 401 drops us back to login.
 *
 * The dashboard mirrors the iOS app's structure: a left-nav router over
 * Library, Favorites, media-type categories, People, Places, Albums, Hidden
 * and Recently Deleted, with a shared lightbox that gains photo details and
 * context actions (favorite / hide / add-to-album / delete / restore).
 */

'use strict';

const POLL_MS = 5000;
const BLOB_CACHE_CAP = 800;

const $ = (id) => document.getElementById(id);

const el = {
  // top bar / status
  statusPill: $('statusPill'),
  statusText: $('statusText'),
  storageSummary: $('storageSummary'),
  userChip: $('userChip'),
  userName: $('userName'),
  accountBtn: $('accountBtn'),
  signoutBtn: $('signoutBtn'),
  themeToggle: $('themeToggle'),
  navToggle: $('navToggle'),
  // shell / nav
  sidebar: $('sidebar'),
  sidebarScrim: $('sidebarScrim'),
  nav: $('nav'),
  content: $('content'),
  viewHead: $('viewHead'),
  // mini server (sidebar foot)
  miniServer: $('miniServer'),
  miniDot: $('miniDot'),
  miniServerName: $('miniServerName'),
  miniServerSub: $('miniServerSub'),
  miniBarPhotos: $('miniBarPhotos'),
  miniBarVideos: $('miniBarVideos'),
  // grid / search
  grid: $('grid'),
  empty: $('emptyState'),
  emptyGlyph: $('emptyGlyph'),
  emptyTitle: $('emptyTitle'),
  emptyText: $('emptyText'),
  searchInput: $('searchInput'),
  searchClear: $('searchClear'),
  // lightbox
  lightbox: $('lightbox'),
  lbBackdrop: $('lbBackdrop'),
  lbStage: $('lbStage'),
  lbClose: $('lbClose'),
  lbPrev: $('lbPrev'),
  lbNext: $('lbNext'),
  lbFilename: $('lbFilename'),
  lbDatetime: $('lbDatetime'),
  lbRows: $('lbRows'),
  lbExifSection: $('lbExifSection'),
  lbExifRows: $('lbExifRows'),
  lbLocSection: $('lbLocSection'),
  lbLocRows: $('lbLocRows'),
  lbMapLink: $('lbMapLink'),
  lbBackup: $('lbBackup'),
  lbActions: $('lbActions'),
  bootLoader: $('bootLoader'),
  pillLoader: $('pillLoader'),
  // modal
  modalRoot: $('modalRoot'),
  modalBackdrop: $('modalBackdrop'),
  modalCard: $('modalCard'),
  selectionBar: $('selectionBar'),
  toast: $('toast'),
  // auth screen
  authScreen: $('authScreen'),
  authTitle: $('authTitle'),
  authSub: $('authSub'),
  authForm: $('authForm'),
  fieldDisplayName: $('fieldDisplayName'),
  authDisplayName: $('authDisplayName'),
  authUsername: $('authUsername'),
  fieldEmail: $('fieldEmail'),
  authEmail: $('authEmail'),
  authPassword: $('authPassword'),
  authError: $('authError'),
  authSubmit: $('authSubmit'),
};

// ---------------------------------------------------------------- SVG bits

const ICON = {
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

const SVG_HEART_FILL =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9C.4 8.6 2 4.5 5.8 4.5c2.1 0 3.4 1.3 4.2 2.4C10.8 5.8 12.1 4.5 14.2 4.5 18 4.5 19.6 8.6 18 12c-2.5 4.4-6 9-6 9z"/></svg>';

const SVG_HEART_OUTLINE =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.5s-7-4.3-9.3-8.4C1.2 9.2 2.6 5.5 6 5.5c1.9 0 3.1 1.2 3.8 2.2C10.5 6.7 11.7 5.5 13.6 5.5c3.4 0 4.8 3.7 3.3 6.6-2.3 4.1-8.9 8.4-8.9 8.4z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SVG_CHECK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SVG_CLOCK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// -------------------------------------------------------------------- auth

/**
 * Session token + user, hydrated from localStorage on boot. `token` being
 * non-null is the single source of truth for "are we authenticated?".
 */
let token = localStorage.getItem('nookToken') || null;
let currentUser = readStoredUser();
let authMode = 'login'; // 'login' | 'setup'
let authBusy = false;

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('nookUser') || 'null');
  } catch (err) {
    return null;
  }
}

function authHeaders() {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

/**
 * Media URL with the token in the query string, for elements that can't send an
 * Authorization header (<video>, <img> streaming). The server/gateway accepts
 * `?token=` for the thumb/original endpoints; the gateway also serves originals
 * with HTTP Range so <video> streams in chunks instead of downloading the file.
 */
function mediaUrl(path) {
  if (!path) return '';
  if (!token) return path;
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

function jsonHeaders() {
  return Object.assign({ 'Content-Type': 'application/json' }, authHeaders());
}

/** Fetch JSON with auth. Bounces to login on 401; throws on other non-2xx. */
async function apiJson(url, opts) {
  const res = await fetch(url, Object.assign({ headers: authHeaders() }, opts || {}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch (e) {
      /* ignore */
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ------------------------------------------------------------- formatting

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n <= 0) return '0 MB';
  let v = n;
  let i = 0;
  while (v >= 1000 && i < BYTE_UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  let str;
  if (v >= 100) str = String(Math.round(v));
  else if (v >= 1) str = v.toFixed(1).replace(/\.0$/, '');
  else str = v.toFixed(2);
  return str + ' ' + BYTE_UNITS[i];
}

function fmtSizeMB(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' MB';
  return fmtBytes(n);
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function fmtCount(n) {
  n = Number(n) || 0;
  return n === 1 ? '1 item' : n.toLocaleString('en-US') + ' items';
}

/** Format a shutter speed: <1s → 1/N, else seconds. */
function fmtExposure(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1) return n.toFixed(n % 1 === 0 ? 0 : 1) + 's';
  return '1/' + Math.round(1 / n) + 's';
}

function dayKeyOf(iso) {
  const d = new Date(iso);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function dayLabelOf(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfThat) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

// ------------------------------------------------- authed blob URL LRU cache

/**
 * Map key -> Promise<objectURL|null>. Insertion order doubles as recency
 * (touched entries are re-inserted); evicted entries get their URL revoked.
 * Failed fetches resolve null and drop out of the cache so a later render
 * retries (e.g. a thumb that hadn't been uploaded yet). Blobs are per-user,
 * so signing out flushes the whole cache.
 */
const blobCache = new Map();

// Cap concurrent image fetches. A large grid firing hundreds of authed blob
// loads at once trips Chrome's ERR_INSUFFICIENT_RESOURCES and churns the LRU
// (revoking blob URLs still in use → ERR_FILE_NOT_FOUND). Combined with the
// lazy-loading observer below, this keeps in-flight image requests small.
const MAX_IMG_FETCHES = 8;
let imgFetchActive = 0;
const imgFetchQueue = [];
function pumpImgQueue() {
  while (imgFetchActive < MAX_IMG_FETCHES && imgFetchQueue.length) {
    imgFetchActive += 1;
    const job = imgFetchQueue.shift();
    fetch(job.url, { headers: authHeaders() }).then(job.resolve, job.reject).finally(() => {
      imgFetchActive -= 1;
      pumpImgQueue();
    });
  }
}
function queuedImgFetch(url) {
  return new Promise((resolve, reject) => {
    imgFetchQueue.push({ url, resolve, reject });
    pumpImgQueue();
  });
}

function getBlobUrl(key, url) {
  if (blobCache.has(key)) {
    const hit = blobCache.get(key);
    blobCache.delete(key);
    blobCache.set(key, hit); // refresh recency
    return hit;
  }
  const entry = queuedImgFetch(url)
    .then((res) => {
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => {
      if (blobCache.get(key) === entry) blobCache.delete(key);
      return null;
    });
  blobCache.set(key, entry);
  while (blobCache.size > BLOB_CACHE_CAP) {
    const oldestKey = blobCache.keys().next().value;
    const oldest = blobCache.get(oldestKey);
    blobCache.delete(oldestKey);
    oldest.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  }
  return entry;
}

function flushBlobCache() {
  for (const entry of blobCache.values()) {
    entry.then((u) => {
      if (u) URL.revokeObjectURL(u);
    });
  }
  blobCache.clear();
}

// ------------------------------------------------------------------- state

let photos = []; // full library (createdAt desc); includes hidden, excludes deleted
let photoIndex = new Map(); // id -> photo (rebuilt on each library change)
let lastLibraryJson = null;
let lastStatusJson = null;
let online = false;
let serverName = 'nook.local';
let serverInfo = null; // last /api/status server+storage+library
let aiEnabled = false;

// On-demand collections (fetched lazily; refreshed after mutations).
let albums = null;
let people = null;
let places = null;

// Current view. kind + optional param. `list` is the photo array on screen
// (what the lightbox pages over). `title`/`subtitle` describe the header.
let view = { kind: 'library' };
let currentList = []; // photos currently rendered (lightbox paging source)
let renderSeq = 0; // guards async view renders against navigation races

// Search: empty query = show `view`; non-empty = show results over the view.
let searchQuery = '';
let searchResults = null;
let searching = false;
let searchSeq = 0;

let lbId = null; // id of the photo open in the lightbox, or null
let lbStageKey = null; // id + uploadState currently rendered in the stage
let lbLoadSeq = 0; // guards async blob loads against stale renders

// Multi-select: while active, tapping a tile toggles selection instead of
// opening the lightbox, and a floating bar offers bulk actions.
let selectMode = false;
let selectedIds = new Set();

// Media-type categories, mirroring iOS BrowseFilter (order + predicates).
const CATEGORIES = {
  favorites: { title: 'Favorites', icon: 'heart', test: (p) => p.favorite },
  videos: { title: 'Videos', icon: 'video', test: (p) => p.mediaType === 'video' },
  portrait: { title: 'Portrait', icon: 'portrait', test: (p) => p.portrait },
  live: { title: 'Live Photos', icon: 'live', test: (p) => p.live },
  panoramas: { title: 'Panoramas', icon: 'pano', test: (p) => p.panorama },
  screenshots: { title: 'Screenshots', icon: 'screenshot', test: (p) => p.screenshot },
};
const CATEGORY_ORDER = ['favorites', 'videos', 'portrait', 'live', 'panoramas', 'screenshots'];

// Photos hidden from the main library are only shown in the Hidden view.
function visiblePhotos() {
  return photos.filter((p) => !p.hidden);
}
function hiddenPhotos() {
  return photos.filter((p) => p.hidden);
}
function categoryPhotos(key) {
  const cat = CATEGORIES[key];
  if (!cat) return [];
  return visiblePhotos().filter(cat.test);
}

function rebuildIndex() {
  photoIndex = new Map();
  for (const p of photos) photoIndex.set(p.id, p);
}

// --------------------------------------------------------------- status UI

function renderStatus(s) {
  serverInfo = s;
  serverName = (s.server && s.server.name) || 'nook.local';
  const version = (s.server && s.server.version) || '';

  const st = s.storage || {};
  const total = Number(st.totalBytes) || 0;
  const used = Number(st.usedBytes) || 0;
  const photoBytes = Number(st.photoBytes) || 0;
  const videoBytes = Number(st.videoBytes) || 0;

  el.storageSummary.textContent = fmtBytes(used) + ' of ' + fmtBytes(total);

  // Sidebar mini server card.
  el.miniServerName.textContent = serverName;
  const items = (s.library && s.library.items) || 0;
  el.miniServerSub.textContent =
    fmtBytes(used) + ' of ' + fmtBytes(total) + (version ? ' · v' + version : '');
  const pct = (bytes) => {
    if (!(bytes > 0) || !(total > 0)) return '0%';
    return Math.max((bytes / total) * 100, 0.75) + '%';
  };
  el.miniBarPhotos.style.width = pct(photoBytes);
  el.miniBarVideos.style.width = pct(videoBytes);
}

function updatePill() {
  if (!token) return;
  el.statusPill.classList.toggle('offline', !online);
  el.miniDot.classList.toggle('off', !online);
  if (!online) {
    el.statusPill.classList.remove('pending');
    el.statusText.textContent = 'Server unreachable';
    return;
  }
  const items = visiblePhotos().length;
  const pending = photos.reduce((n, p) => n + (p.uploadState === 'pending' ? 1 : 0), 0);
  if (pending > 0) {
    el.statusPill.classList.add('pending');
    el.statusText.textContent = 'Backing up · ' + pending + ' remaining';
  } else {
    el.statusPill.classList.remove('pending');
    el.statusText.textContent =
      items === 0
        ? 'Connected to your server'
        : 'All backed up · ' + items.toLocaleString('en-US') + (items === 1 ? ' item' : ' items');
  }
}

function renderUser() {
  if (!currentUser) {
    el.userChip.classList.add('hidden');
    return;
  }
  el.userName.textContent = currentUser.displayName || currentUser.username || 'Account';
  el.userChip.classList.remove('hidden');
}

// ----------------------------------------------------------------- sidebar

/** Build the left-nav from the current library + AI availability. */
function renderNav() {
  const groups = [];

  // Primary: Library + Favorites + media-type categories that have photos.
  const primary = [{ kind: 'library', title: 'Library', icon: 'library', count: visiblePhotos().length }];
  for (const key of CATEGORY_ORDER) {
    const n = categoryPhotos(key).length;
    if (key === 'favorites' || n > 0) {
      primary.push({ kind: 'category', param: key, title: CATEGORIES[key].title, icon: CATEGORIES[key].icon, count: n });
    }
  }
  groups.push({ items: primary });

  // People & Places (AI). Only when the indexer has produced clusters.
  const pp = [];
  if (aiEnabled) {
    pp.push({ kind: 'people', title: 'People', icon: 'people', count: people ? people.length : null });
    pp.push({ kind: 'places', title: 'Places', icon: 'places', count: places ? places.length : null });
  }
  if (pp.length) groups.push({ label: 'People & Places', items: pp });

  // Albums.
  groups.push({
    label: 'Albums',
    items: [{ kind: 'albums', title: 'Albums', icon: 'albums', count: albums ? albums.length : null }],
  });

  // Utilities.
  groups.push({
    label: 'Library',
    items: [
      { kind: 'hidden', title: 'Hidden', icon: 'hidden', count: hiddenPhotos().length || null },
      { kind: 'deleted', title: 'Recently Deleted', icon: 'trash', count: null },
    ],
  });

  el.nav.replaceChildren();
  for (const g of groups) {
    if (g.label) {
      const h = document.createElement('div');
      h.className = 'nav-label';
      h.textContent = g.label;
      el.nav.appendChild(h);
    }
    for (const it of g.items) {
      el.nav.appendChild(makeNavItem(it));
    }
  }
}

function navKey(item) {
  return item.kind + (item.param ? ':' + item.param : '');
}

function isActiveNav(item) {
  if (searchResults !== null) return false;
  if (view.kind === item.kind) {
    if (item.kind === 'category') return view.param === item.param;
    return true;
  }
  // Detail views highlight their parent section.
  if (item.kind === 'people' && view.kind === 'person') return true;
  if (item.kind === 'places' && view.kind === 'place') return true;
  if (item.kind === 'albums' && view.kind === 'album') return true;
  return false;
}

function makeNavItem(item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item';
  if (isActiveNav(item)) btn.classList.add('active');
  const icon = document.createElement('span');
  icon.className = 'nav-ico';
  icon.innerHTML = ICON[item.icon] || '';
  const label = document.createElement('span');
  label.className = 'nav-txt';
  label.textContent = item.title;
  btn.append(icon, label);
  if (item.count != null && item.count > 0) {
    const badge = document.createElement('span');
    badge.className = 'nav-count';
    badge.textContent = item.count > 999 ? '999+' : String(item.count);
    btn.appendChild(badge);
  }
  btn.addEventListener('click', () => {
    clearSearchInput();
    navigate({ kind: item.kind, param: item.param });
    closeSidebar();
  });
  return btn;
}

function openSidebar() {
  el.sidebar.classList.add('open');
  el.sidebarScrim.classList.add('show');
}
function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.sidebarScrim.classList.remove('show');
}

// ------------------------------------------------------------------ router

/**
 * Switch views. Fetches any data the view needs, then renders. Guarded by
 * renderSeq so a fast nav sequence always ends on the latest view.
 */
async function navigate(next) {
  // Hidden and Recently Deleted are private — require the account password once
  // per session before entering (or restoring them from the URL on reload).
  if ((next.kind === 'hidden' || next.kind === 'deleted') && !privateUnlocked) {
    const ok = await requireUnlock(next.kind === 'hidden' ? 'Hidden' : 'Recently Deleted');
    if (!ok) {
      // Stay put; keep the URL in sync with the view we did NOT leave.
      syncHash(view);
      renderNav();
      return;
    }
  }

  // Leaving a view drops any in-progress selection.
  if (selectMode) {
    selectMode = false;
    selectedIds = new Set();
    el.selectionBar.classList.add('hidden');
  }
  view = next;
  syncHash(next);
  const seq = ++renderSeq;
  renderNav();
  window.scrollTo(0, 0);
  if (el.content) el.content.scrollTop = 0;

  try {
    if (next.kind === 'albums') {
      if (!albums) await loadAlbums();
    } else if (next.kind === 'album') {
      if (!albums) await loadAlbums();
    } else if (next.kind === 'people') {
      if (!people) await loadPeople();
    } else if (next.kind === 'places') {
      if (!places) await loadPlaces();
    } else if (next.kind === 'person') {
      if (!next._person) {
        if (!people) await loadPeople();
        next._person = (people || []).find((x) => x.id === next.param) || null;
      }
      next._photos = await fetchPhotos('/api/people/' + encodeURIComponent(next.param) + '/photos');
    } else if (next.kind === 'place') {
      next._photos = await fetchPhotos('/api/place-photos?label=' + encodeURIComponent(next.param));
    } else if (next.kind === 'deleted') {
      next._photos = await fetchPhotos('/api/deleted');
    }
  } catch (e) {
    /* fetch failure renders an empty view; a poll/retry can recover */
  }
  if (seq !== renderSeq) return; // superseded
  renderNav();
  renderView();
}

// Private-folder lock: verify the account password (against the server), then
// keep it unlocked for the rest of the session. Reset on sign-out.
let privateUnlocked = false;

async function requireUnlock(label) {
  if (privateUnlocked) return true;
  const pw = await promptModal({
    title: 'Unlock ' + label,
    placeholder: 'Account password',
    confirm: 'Unlock',
    password: true,
  });
  if (!pw) return false;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser && currentUser.username, password: pw }),
    });
    if (res.ok) {
      privateUnlocked = true;
      return true;
    }
  } catch (e) {
    /* fall through to the error toast */
  }
  toast('Incorrect password');
  return false;
}

async function fetchPhotos(url) {
  const j = await apiJson(url);
  return (j && j.photos) || [];
}

// ----------------------------------------------------------- URL routing
// Views are mirrored into the URL hash so a reload (or a shared link) restores
// exactly where you were, and the browser Back/Forward buttons work.

let suppressHashSync = false;

function viewToHash(v) {
  switch (v.kind) {
    case 'category': return '#/category/' + encodeURIComponent(v.param);
    case 'hidden': return '#/hidden';
    case 'deleted': return '#/deleted';
    case 'people': return '#/people';
    case 'places': return '#/places';
    case 'albums': return '#/albums';
    case 'person': return '#/person/' + encodeURIComponent(v.param);
    case 'place': return '#/place/' + encodeURIComponent(v.param);
    case 'album': return '#/album/' + encodeURIComponent(v.param);
    case 'library':
    default: return '#/';
  }
}

function hashToView(hash) {
  const h = (hash || '').replace(/^#\/?/, '');
  if (!h) return { kind: 'library' };
  const slash = h.indexOf('/');
  const kind = slash === -1 ? h : h.slice(0, slash);
  const param = slash === -1 ? undefined : decodeURIComponent(h.slice(slash + 1));
  switch (kind) {
    case 'category': return param ? { kind: 'category', param } : { kind: 'library' };
    case 'hidden': return { kind: 'hidden' };
    case 'deleted': return { kind: 'deleted' };
    case 'people': return { kind: 'people' };
    case 'places': return { kind: 'places' };
    case 'albums': return { kind: 'albums' };
    case 'person': return param ? { kind: 'person', param } : { kind: 'people' };
    case 'place': return param ? { kind: 'place', param } : { kind: 'places' };
    case 'album': return param ? { kind: 'album', param } : { kind: 'albums' };
    default: return { kind: 'library' };
  }
}

function syncHash(v) {
  const target = viewToHash(v);
  if (location.hash !== target) {
    suppressHashSync = true;
    location.hash = target;
    setTimeout(() => { suppressHashSync = false; }, 0);
  }
}

function sameView(a, b) {
  return a && b && a.kind === b.kind && String(a.param || '') === String(b.param || '');
}

window.addEventListener('hashchange', () => {
  if (suppressHashSync || !token) return;
  const next = hashToView(location.hash);
  if (sameView(view, next)) return;
  navigate(next);
});

async function loadAlbums() {
  try {
    const j = await apiJson('/api/albums');
    albums = (j && j.albums) || [];
  } catch (e) {
    albums = albums || [];
  }
}
async function loadPeople() {
  try {
    const j = await apiJson('/api/people');
    people = (j && j.people) || [];
  } catch (e) {
    people = [];
  }
}
async function loadPlaces() {
  try {
    const j = await apiJson('/api/places');
    places = (j && j.places) || [];
  } catch (e) {
    places = [];
  }
}

// ------------------------------------------------------------- view header

function setHead(title, subtitle, opts) {
  opts = opts || {};
  el.viewHead.replaceChildren();
  const row = document.createElement('div');
  row.className = 'vh-row';

  if (opts.back) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'vh-back';
    back.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
    back.lastChild.textContent = opts.back.label;
    back.addEventListener('click', opts.back.onClick);
    el.viewHead.appendChild(back);
  }

  const titleWrap = document.createElement('div');
  titleWrap.className = 'vh-title-wrap';
  const h = document.createElement('h1');
  h.className = 'vh-title';
  h.textContent = title;
  titleWrap.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'vh-sub';
    sub.textContent = subtitle;
    titleWrap.appendChild(sub);
  }
  row.appendChild(titleWrap);

  if (opts.actions && opts.actions.length) {
    const acts = document.createElement('div');
    acts.className = 'vh-actions';
    for (const a of opts.actions) acts.appendChild(a);
    row.appendChild(acts);
  }
  el.viewHead.appendChild(row);
}

function headBtn(label, onClick, opts) {
  opts = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'vh-btn' + (opts.primary ? ' primary' : '') + (opts.danger ? ' danger' : '');
  if (opts.icon) {
    const i = document.createElement('span');
    i.className = 'vh-btn-ico';
    i.innerHTML = opts.icon;
    b.appendChild(i);
  }
  const t = document.createElement('span');
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', onClick);
  return b;
}

// ------------------------------------------------------------------ tiles

/**
 * Point `img` at `url` and call `onSettled(ok)` exactly once — on load, on
 * error, OR immediately if the blob was already decoded. A missing error path
 * is what left tiles shimmering forever, so this always resolves.
 */
function paintImage(img, url, onSettled) {
  let done = false;
  const settle = (ok) => {
    if (done) return;
    done = true;
    img.removeEventListener('load', onLoad);
    img.removeEventListener('error', onError);
    if (ok) img.classList.add('loaded');
    if (onSettled) onSettled(ok);
  };
  const onLoad = () => settle(true);
  const onError = () => settle(false);
  img.addEventListener('load', onLoad);
  img.addEventListener('error', onError);
  img.src = url;
  if (img.complete && img.naturalWidth > 0) settle(true); // already cached/decoded
}

/**
 * Lazy-load: only fetch a tile's thumbnail once it scrolls near the viewport.
 * Without this, a large library renders every tile at once and fires hundreds
 * of simultaneous authed fetches → ERR_INSUFFICIENT_RESOURCES.
 */
const thumbObserver =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const host = e.target;
            thumbObserver.unobserve(host);
            const fn = host._loadThumb;
            host._loadThumb = null;
            if (fn) fn();
          }
        },
        { rootMargin: '600px 0px' }
      )
    : null;

/**
 * Density-aware thumbnail width: the smallest server bucket that covers the
 * current tile size at this screen's pixel ratio — the grid downloads only
 * what it can actually display (lighter zoomed out, sharper zoomed in).
 */
const THUMB_BUCKETS = [128, 192, 256, 384, 512];
function gridThumbW() {
  const px = GRID_ZOOM_LEVELS[gridZoomIndex()] * Math.min(window.devicePixelRatio || 1, 2);
  for (const b of THUMB_BUCKETS) if (b >= px) return b;
  return THUMB_BUCKETS[THUMB_BUCKETS.length - 1];
}

/** Load a thumbnail blob into a container element with shimmer + failed states. */
function loadThumb(host, img, photoId, thumbPath) {
  host.classList.add('thumb-loading');
  const w = gridThumbW();
  const sizedPath = thumbPath + (thumbPath.indexOf('?') >= 0 ? '&' : '?') + 'w=' + w;
  const doLoad = () => {
    getBlobUrl('thumb:' + photoId + ':' + w, sizedPath).then((u) => {
      if (!u || !img.isConnected) {
        host.classList.remove('thumb-loading');
        host.classList.add('thumb-failed');
        return;
      }
      paintImage(img, u, (ok) => {
        host.classList.remove('thumb-loading');
        host.classList.toggle('thumb-failed', !ok);
      });
    });
  };
  if (thumbObserver) {
    host._loadThumb = doLoad;
    thumbObserver.observe(host);
  } else {
    doLoad();
  }
}

function makeTile(p) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.dataset.id = p.id;
  tile.setAttribute('aria-label', p.filename);

  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  tile.appendChild(img);
  loadThumb(tile, img, p.id, p.thumbUrl);

  if (p.mediaType === 'video') {
    const badge = document.createElement('span');
    badge.className = 'badge-duration';
    badge.textContent = fmtDuration(p.duration);
    tile.appendChild(badge);
  }

  if (p.favorite) {
    const heart = document.createElement('span');
    heart.className = 'tile-heart';
    heart.innerHTML = SVG_HEART_FILL;
    tile.appendChild(heart);
  }

  if (p.uploadState === 'pending') {
    const chip = document.createElement('span');
    chip.className = 'chip-uploading';
    chip.textContent = 'uploading…';
    tile.appendChild(chip);
  }

  if (selectMode) {
    tile.classList.add('selectable');
    if (selectedIds.has(p.id)) tile.classList.add('selected');
    const check = document.createElement('span');
    check.className = 'tile-check';
    check.innerHTML = SVG_CHECK;
    tile.appendChild(check);
  }

  tile.addEventListener('click', () => {
    if (selectMode) toggleSelect(p.id, tile);
    else openLightbox(p.id);
  });
  return tile;
}

// ---------------------------------------------------------------- selection

function toggleSelect(id, tile) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    tile.classList.remove('selected');
  } else {
    selectedIds.add(id);
    tile.classList.add('selected');
  }
  renderSelectionBar();
}

/** Sync the .selected class on all rendered tiles to the current selection. */
function refreshTileSelection() {
  el.grid.querySelectorAll('.tile').forEach((t) => {
    if (t.dataset.id) t.classList.toggle('selected', selectedIds.has(t.dataset.id));
  });
}

/** Select-all / deselect-all for one day section (works across windowed tiles). */
function toggleSelectDay(dayIds, btn) {
  const allSelected = dayIds.length > 0 && dayIds.every((id) => selectedIds.has(id));
  for (const id of dayIds) {
    if (allSelected) selectedIds.delete(id);
    else selectedIds.add(id);
  }
  if (btn) btn.textContent = allSelected ? 'Select all' : 'Deselect';
  refreshTileSelection();
  renderSelectionBar();
}

function enterSelectMode() {
  selectMode = true;
  selectedIds = new Set();
  renderView();
  renderSelectionBar();
}

function exitSelectMode() {
  if (!selectMode) return;
  selectMode = false;
  selectedIds = new Set();
  el.selectionBar.classList.add('hidden');
  renderView();
}

/** A "Select"/"Done" header button for photo-list views. */
function selectBtn() {
  return headBtn(selectMode ? 'Done' : 'Select', () =>
    selectMode ? exitSelectMode() : enterSelectMode()
  );
}

/** The photos backing the current list, resolved from ids (for bulk actions). */
function selectedPhotos() {
  const out = [];
  for (const id of selectedIds) {
    const p = photoIndex.get(id) || (view._photos || []).find((x) => x.id === id);
    if (p) out.push(p);
  }
  return out;
}

function renderSelectionBar() {
  if (!selectMode) {
    el.selectionBar.classList.add('hidden');
    return;
  }
  const n = selectedIds.size;
  el.selectionBar.replaceChildren();

  const label = document.createElement('span');
  label.className = 'sel-count';
  label.textContent = n === 0 ? 'Select photos' : n + ' selected';
  el.selectionBar.appendChild(label);

  const acts = document.createElement('div');
  acts.className = 'sel-actions';
  const mk = (title, html, fn, opts) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sel-btn' + (opts && opts.danger ? ' danger' : '');
    b.title = title;
    b.disabled = n === 0;
    b.innerHTML = html + '<span>' + title + '</span>';
    b.addEventListener('click', fn);
    return b;
  };

  const SVG_DOWNLOAD =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  if (view.kind === 'deleted') {
    acts.append(
      mk('Restore', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v3.5h3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>', bulkRestore),
      mk('Download', SVG_DOWNLOAD, bulkDownload),
      mk('Delete', ICON.trash, bulkPermanent, { danger: true })
    );
  } else {
    acts.append(
      mk('Favorite', SVG_HEART_OUTLINE, bulkFavorite),
      mk('Add to Album', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M19 9v9.5A2.5 2.5 0 0 1 16.5 21H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', bulkAddToAlbum),
      mk('Hide', ICON.hidden, bulkHide),
      mk('Download', SVG_DOWNLOAD, bulkDownload),
      mk('Delete', ICON.trash, bulkDelete, { danger: true })
    );
    if (view.kind === 'album') {
      if (n === 1) {
        acts.append(mk('Set cover', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M4 16l4.5-4 3 2.5 3.5-3.5 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>', bulkSetCover));
      }
      acts.append(mk('Remove', '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 12h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>', bulkRemoveFromAlbum));
    }
  }
  el.selectionBar.appendChild(acts);
  el.selectionBar.classList.remove('hidden');
}

// Run `fn(id)` for each selected id, tolerating per-item failures.
async function bulkEach(fn) {
  const ids = [...selectedIds];
  let ok = 0;
  for (const id of ids) {
    try {
      await fn(id);
      ok += 1;
    } catch (err) {
      if (err && err.message === 'unauthorized') return -1;
    }
  }
  return ok;
}

async function bulkFavorite() {
  const n = await bulkEach(async (id) => {
    const p = photoIndex.get(id);
    if (!p || p.favorite) return;
    const u = await apiJson('/api/photos/' + id, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ favorite: true }),
    });
    applyPhotoUpdate(u);
  });
  finishBulk(n, 'Added to Favorites');
}

async function bulkHide() {
  const n = await bulkEach(async (id) => {
    const p = photoIndex.get(id);
    if (!p || p.hidden) return;
    const u = await apiJson('/api/photos/' + id, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ hidden: true }),
    });
    applyPhotoUpdate(u);
  });
  finishBulk(n, 'Hidden');
}

async function bulkDelete() {
  const count = selectedIds.size;
  const ok = await confirmModal({
    title: 'Delete ' + count + (count === 1 ? ' photo?' : ' photos?'),
    body: 'They move to Recently Deleted and are removed forever after 30 days.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const n = await bulkEach(async (id) => {
    await apiJson('/api/photos/' + id, { method: 'DELETE' });
    photos = photos.filter((x) => x.id !== id);
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== id);
    pruneFromAlbums(id);
  });
  people = null;
  places = null;
  rebuildIndex();
  lastLibraryJson = null;
  finishBulk(n, 'Moved to Recently Deleted');
}

async function bulkRestore() {
  const n = await bulkEach(async (id) => {
    await apiJson('/api/photos/' + id + '/restore', { method: 'POST' });
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== id);
  });
  people = null;
  places = null;
  lastLibraryJson = null;
  finishBulk(n, 'Restored');
  tick();
}

async function bulkPermanent() {
  const count = selectedIds.size;
  const ok = await confirmModal({
    title: 'Delete ' + count + (count === 1 ? ' photo' : ' photos') + ' permanently?',
    body: 'This cannot be undone.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const n = await bulkEach(async (id) => {
    await apiJson('/api/photos/' + id + '/permanent', { method: 'DELETE' });
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== id);
  });
  finishBulk(n, 'Deleted');
}

async function bulkAddToAlbum() {
  if (!albums) await loadAlbums();
  const ids = [...selectedIds];
  const choice = await albumPickerModal({ id: '__bulk__' }); // picker never marks "Added" for a fake id
  if (!choice) return;
  let albumId = choice.albumId;
  try {
    if (choice.createName) {
      const created = await apiJson('/api/albums', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: choice.createName }),
      });
      albums = [created].concat(albums || []);
      albumId = created.id;
    }
    const updated = await apiJson('/api/albums/' + albumId, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ addPhotoIds: ids }),
    });
    replaceAlbum(updated);
    finishBulk(ids.length, 'Added to “' + updated.name + '”');
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not add to album');
  }
}

async function bulkRemoveFromAlbum() {
  if (view.kind !== 'album') return;
  const ids = [...selectedIds];
  try {
    const updated = await apiJson('/api/albums/' + view.param, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ removePhotoIds: ids }),
    });
    replaceAlbum(updated);
    finishBulk(ids.length, 'Removed from album');
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not remove');
  }
}

async function bulkSetCover() {
  if (view.kind !== 'album' || selectedIds.size !== 1) return;
  const coverPhotoId = [...selectedIds][0];
  try {
    const updated = await apiJson('/api/albums/' + view.param, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ coverPhotoId }),
    });
    replaceAlbum(updated);
    finishBulk(1, 'Set as cover');
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not set cover');
  }
}

// ------------------------------------------------------- multi-select download
// One selected photo downloads directly with its filename; several become a
// single ZIP built in the browser (STORE method — photo/video bytes are already
// compressed, so zipping is instant and dependency-free).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const yr = Math.max(1980, d.getFullYear());
  return {
    date: ((yr - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** Build an uncompressed ZIP from [{name, data: Uint8Array, date: Date}]. */
function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const { date, time } = dosDateTime(f.date || new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version needed
    local.setUint16(6, 0x0800, true);    // UTF-8 names
    local.setUint16(8, 0, true);         // method: store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);           // made by
    cd.setUint16(6, 20, true);           // needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);      // local header offset
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + f.data.length;
  }

  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function bulkDownload() {
  const photos = selectedPhotos().filter((p) => p.uploadState === 'complete');
  if (!photos.length) {
    toast('Nothing downloadable selected');
    return;
  }

  // Single photo: plain download with its own filename.
  if (photos.length === 1) {
    const p = photos[0];
    try {
      const res = await fetch(p.originalUrl, { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      saveBlob(await res.blob(), p.filename);
      finishBulk(1, 'Downloaded');
    } catch (e) {
      toast('Download failed');
    }
    return;
  }

  const totalBytes = photos.reduce((s, p) => s + (p.bytes || 0), 0);
  if (totalBytes > 400 * 1024 * 1024) {
    const ok = await confirmModal({
      title: 'Large download',
      body: 'This selection is about ' + fmtSizeMB(totalBytes) + '. Build the ZIP anyway?',
      confirm: 'Download',
    });
    if (!ok) return;
  }

  const files = [];
  const used = new Set();
  let i = 0;
  for (const p of photos) {
    i++;
    toast('Downloading ' + i + ' of ' + photos.length + '…');
    try {
      const res = await fetch(p.originalUrl, { headers: authHeaders() });
      if (!res.ok) continue;
      let name = p.filename || p.id;
      if (used.has(name)) {
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let n = 2;
        while (used.has(base + ' (' + n + ')' + ext)) n++;
        name = base + ' (' + n + ')' + ext;
      }
      used.add(name);
      files.push({ name, data: new Uint8Array(await res.arrayBuffer()), date: new Date(p.createdAt) });
    } catch (e) {
      /* skip failed item; keep going */
    }
  }
  if (!files.length) {
    toast('Download failed');
    return;
  }
  toast('Building ZIP…');
  const stamp = new Date().toISOString().slice(0, 10);
  saveBlob(buildZip(files), 'nook-photos-' + stamp + '.zip');
  finishBulk(files.length, 'Downloaded');
}

/** Common tail for a bulk action: toast, exit select mode, refresh. */
function finishBulk(n, verb) {
  if (n === -1) return; // hit a 401; already bounced to login
  toast(n + (n === 1 ? ' photo · ' : ' photos · ') + verb);
  exitSelectMode(); // clears selection + re-renders the view
  renderNav();
}

/** A cover card (album / place): 1:1 thumb, gradient, title + subtitle overlay. */
function makeCoverTile(opts) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'cover-tile';
  tile.setAttribute('aria-label', opts.title);

  const media = document.createElement('div');
  media.className = 'cover-media';
  if (opts.coverPhotoId) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    media.appendChild(img);
    loadThumb(media, img, opts.coverPhotoId, '/api/photos/' + opts.coverPhotoId + '/thumb');
  } else {
    media.classList.add('cover-empty');
    media.innerHTML = '<span class="cover-ph">' + (ICON[opts.icon] || ICON.albums) + '</span>';
  }
  const grad = document.createElement('div');
  grad.className = 'cover-grad';
  const cap = document.createElement('div');
  cap.className = 'cover-cap';
  const t = document.createElement('div');
  t.className = 'cover-title';
  t.textContent = opts.title;
  const s = document.createElement('div');
  s.className = 'cover-sub';
  s.textContent = opts.subtitle || '';
  cap.append(t, s);
  media.append(grad, cap);
  tile.appendChild(media);
  tile.addEventListener('click', opts.onClick);
  return tile;
}

/** A circular person avatar tile, face-cropped from the cover thumb when known. */
function makePersonTile(person) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'person-tile';
  const av = document.createElement('div');
  av.className = 'person-av';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  // coverFace is a normalized [x,y,w,h] bbox; zoom+translate so it centers.
  if (Array.isArray(person.coverFace) && person.coverFace.length === 4) {
    const [fx, fy, fw, fh] = person.coverFace;
    const cx = (fx + fw / 2) * 100;
    const cy = (fy + fh / 2) * 100;
    const scale = Math.min(3.2, Math.max(1.3, 0.6 / Math.max(fw, fh)));
    img.style.transform = 'scale(' + scale.toFixed(2) + ')';
    img.style.transformOrigin = cx.toFixed(1) + '% ' + cy.toFixed(1) + '%';
  }
  av.appendChild(img);
  loadThumb(av, img, person.coverPhotoId, person.coverThumbUrl);
  const name = document.createElement('div');
  name.className = 'person-name';
  name.textContent = person.name || 'Add Name';
  if (!person.name) name.classList.add('unnamed');
  const count = document.createElement('div');
  count.className = 'person-count';
  count.textContent = fmtCount(person.count);
  tile.append(av, name, count);
  tile.addEventListener('click', () =>
    navigate({ kind: 'person', param: person.id, _person: person })
  );
  return tile;
}

// ------------------------------------------------------------ view renders

function renderView() {
  gridWindow = null; // photo-grid renderers re-arm this; others leave it off
  // Search overrides whatever section is selected.
  if (searchResults !== null) return renderSearch();

  switch (view.kind) {
    case 'library':
      return renderPhotoView(visiblePhotos(), { grouped: true, title: 'Library', emptyKind: 'library' });
    case 'category': {
      const cat = CATEGORIES[view.param];
      return renderPhotoView(categoryPhotos(view.param), {
        title: cat ? cat.title : 'Photos',
        emptyKind: view.param,
      });
    }
    case 'hidden':
      return renderPhotoView(hiddenPhotos(), { title: 'Hidden', emptyKind: 'hidden' });
    case 'deleted':
      return renderDeleted(view._photos || []);
    case 'people':
      return renderPeople();
    case 'places':
      return renderPlaces();
    case 'person':
      return renderPersonOrPlace(view._photos || [], {
        title: (view._person && view._person.name) || 'Person',
        person: view._person,
        back: { label: 'People', onClick: () => navigate({ kind: 'people' }) },
      });
    case 'place':
      return renderPersonOrPlace(view._photos || [], {
        title: view.param,
        back: { label: 'Places', onClick: () => navigate({ kind: 'places' }) },
      });
    case 'albums':
      return renderAlbums();
    case 'album':
      return renderAlbumDetail(view.param);
    default:
      return renderPhotoView(visiblePhotos(), { grouped: true, title: 'Library', emptyKind: 'library' });
  }
}

/** Day-grouped or flat photo grid for a plain list of photos. */
function renderPhotoView(list, opts) {
  opts = opts || {};
  currentList = list;
  setHead(opts.title, list.length ? fmtCount(list.length) : '', list.length ? { actions: [selectBtn()] } : {});
  el.grid.replaceChildren();
  if (list.length === 0) {
    showEmpty(opts.emptyKind || 'generic');
    return;
  }
  hideEmpty();
  if (opts.grouped) {
    renderDayGroups(list, el.grid);
  } else {
    renderPhotoList(list, el.grid, false);
  }
}

/**
 * Windowed grid renderer. Instead of building a DOM node for every one of
 * (potentially) tens of thousands of photos up front — which janks layout and
 * floods the network — it renders in batches and appends the next batch only as
 * a viewport sentinel scrolls into range. Each batch is sized to comfortably
 * exceed a screen, so scrolling stays smooth and initial paint is tiny. Image
 * bytes are still lazy-loaded per-tile by thumbObserver.
 */
// The active windowed list for the current view (null when the view isn't a
// photo grid). A single global scroll listener drives it.
let gridWindow = null;

function nearViewportBottom(px) {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - px;
}

function renderPhotoList(list, host, grouped) {
  if (grouped) {
    // Day segments (single pass — also powers per-day "Select all" without
    // re-filtering the whole list per header).
    const segs = [];
    let cur = null;
    for (let i = 0; i < list.length; i++) {
      const key = dayKeyOf(list[i].createdAt);
      if (!cur || cur.key !== key) {
        cur = { key, label: dayLabelOf(list[i].createdAt), start: i, count: 0 };
        segs.push(cur);
      }
      cur.count += 1;
    }
    renderChunkedGrid(list, host, segs, true);
    return;
  }

  // Flat lists (categories, albums, search, deleted, people/places detail):
  // headerless segments sized to a whole number of grid rows, so chunk
  // boundaries never leave a ragged row. If the predicted column count turns
  // out wrong (e.g. scrollbar appearing changed the width), rebuild once with
  // the measured one.
  let cols = predictCols(host);
  for (let attempt = 0; attempt < 2; attempt++) {
    const per = Math.max(cols * Math.ceil(CHUNK_TARGET / cols), cols);
    const segs = [];
    for (let i = 0; i < list.length; i += per) {
      segs.push({ label: null, start: i, count: Math.min(per, list.length - i) });
    }
    const measured = renderChunkedGrid(list, host, segs, false);
    if (!measured || per % measured === 0) break;
    cols = measured;
    host.querySelectorAll('.grid-chunk').forEach((e) => e.remove());
  }
}

/** Predict the auto-fill column count the same way CSS grid resolves it. */
function predictCols(host) {
  const w = host.clientWidth || el.grid.clientWidth || 1200;
  const tileMin = GRID_ZOOM_LEVELS[gridZoomIndex()];
  return Math.max(1, Math.floor((w + GRID_GAP) / (tileMin + GRID_GAP)));
}

/**
 * Chunked virtual grid — the virtual scroller behind every photo grid.
 *
 * The list is split into chunks of whole segments (~CHUNK_TARGET photos each —
 * real days in grouped views, row-aligned runs in flat ones) and
 * every chunk gets a shell <div> up front. Off-screen shells are empty spacers
 * with estimated heights, so the scrollbar reflects the entire library
 * immediately and dragging it anywhere works. On scroll, chunks entering the
 * keep-range fill with real tiles and far-away ones release back to
 * fixed-height spacers — the live DOM stays at a few hundred tiles no matter
 * how deep into a 10k+ library you go. Day alignment means a chunk boundary
 * never splits a CSS grid, so recycling is invisible. Estimated heights are
 * replaced by measured ones as chunks activate; the browser's scroll anchoring
 * absorbs the tiny corrections.
 */
const CHUNK_TARGET = 120; // photos per chunk (rounded up to whole segments)
const CHUNK_KEEP_PX = 2600; // keep chunks alive within this margin of the viewport
const GRID_GAP = 2; // must match .day-grid { gap } in styles.css

/**
 * @param segs  contiguous {label, start, count} slices of `list` — real days
 *              (withHeaders) or artificial row-aligned runs (flat).
 * @returns the measured column count (null until a chunk has rendered).
 */
function renderChunkedGrid(list, host, segs, withHeaders) {
  if (!segs.length) {
    gridWindow = null;
    return null;
  }

  // Whole-segment chunks of >= CHUNK_TARGET photos.
  const chunks = [];
  for (let si = 0; si < segs.length; ) {
    const c = { segs: [], el: null, active: false };
    let n = 0;
    while (si < segs.length && n < CHUNK_TARGET) {
      c.segs.push(segs[si]);
      n += segs[si].count;
      si += 1;
    }
    chunks.push(c);
  }

  // All shells up front → the scrollbar spans the full library from the start.
  const shells = document.createDocumentFragment();
  for (const c of chunks) {
    c.el = document.createElement('div');
    c.el.className = 'grid-chunk';
    shells.appendChild(c.el);
  }
  host.appendChild(shells);

  const fillChunk = (c) => {
    const frag = document.createDocumentFragment();
    for (const s of c.segs) {
      const grid = document.createElement('div');
      grid.className = 'day-grid';
      for (let i = s.start; i < s.start + s.count; i++) grid.appendChild(makeTile(list[i]));
      if (withHeaders) {
        const group = document.createElement('section');
        group.className = 'day-group';
        const header = document.createElement('h2');
        header.className = 'day-header';
        const label = document.createElement('span');
        label.textContent = s.label;
        header.appendChild(label);
        if (selectMode) {
          const dayIds = [];
          for (let i = s.start; i < s.start + s.count; i++) dayIds.push(list[i].id);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'day-select-btn';
          btn.textContent = dayIds.every((id) => selectedIds.has(id)) ? 'Deselect' : 'Select all';
          btn.addEventListener('click', () => toggleSelectDay(dayIds, btn));
          header.appendChild(btn);
        }
        group.append(header, grid);
        frag.appendChild(group);
      } else {
        // Keep the 2px row rhythm across sibling grids / chunk boundaries.
        grid.style.marginBottom = GRID_GAP + 'px';
        frag.appendChild(grid);
      }
    }
    c.el.style.height = '';
    c.el.replaceChildren(frag);
    c.active = true;
  };

  const releaseChunk = (c, height) => {
    // Unhook tiles still waiting on the lazy-thumb observer before dropping them.
    if (thumbObserver) {
      c.el.querySelectorAll('.tile').forEach((t) => {
        if (t._loadThumb) {
          t._loadThumb = null;
          thumbObserver.unobserve(t);
        }
      });
    }
    c.el.replaceChildren();
    c.el.style.height = (height || estimateChunkHeight(c)) + 'px';
    c.active = false;
  };

  // Geometry sampled from a live chunk; drives spacer-height estimates.
  let metrics = null;
  const measureMetrics = () => {
    const c = chunks.find((x) => x.active);
    const segEl = c && c.el.firstElementChild; // .day-group or bare .day-grid
    const grid = segEl && (withHeaders ? segEl.querySelector('.day-grid') : segEl);
    const tile = grid && grid.querySelector('.tile');
    if (!tile) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const tileH = tile.getBoundingClientRect().height;
    const rows = Math.ceil(c.segs[0].count / cols);
    const gridH = rows * tileH + (rows - 1) * GRID_GAP;
    const cs = getComputedStyle(segEl);
    // Per-segment chrome: header + paddings + margins around the grid rows.
    const chrome =
      segEl.getBoundingClientRect().height -
      gridH +
      (parseFloat(cs.marginTop) || 0) +
      (parseFloat(cs.marginBottom) || 0);
    metrics = { cols, tileH, chrome: Math.max(0, chrome) };
  };

  const estimateChunkHeight = (c) => {
    const m = metrics || { cols: 5, tileH: 182, chrome: withHeaders ? 46 : GRID_GAP };
    let h = 0;
    for (const s of c.segs) {
      const rows = Math.ceil(s.count / m.cols);
      h += m.chrome + rows * m.tileH + (rows - 1) * GRID_GAP;
    }
    return Math.round(h);
  };

  // Fill/release to the current viewport. Reads all geometry first, then
  // mutates, so a pass costs a single layout.
  const virtualize = () => {
    if (!host.isConnected) return;
    const min = -CHUNK_KEEP_PX;
    const max = window.innerHeight + CHUNK_KEEP_PX;
    const rects = chunks.map((c) => c.el.getBoundingClientRect());
    let filled = false;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const inRange = rects[i].bottom >= min && rects[i].top <= max;
      if (c.active && !inRange) releaseChunk(c, rects[i].height);
      else if (!c.active && inRange) {
        fillChunk(c);
        filled = true;
      }
    }
    if (filled && !metrics) measureMetrics();
  };

  // Zoom / resize changed tile geometry: refresh every spacer's estimate.
  const relayout = () => {
    if (!host.isConnected) return;
    metrics = null;
    measureMetrics();
    // Flat segments are sized to whole rows for a specific column count — if
    // that changed, rebuild the view so chunk boundaries stay row-aligned.
    if (
      !withHeaders &&
      metrics &&
      chunks.length > 1 &&
      chunks[0].segs[0].count % metrics.cols !== 0
    ) {
      renderView();
      return;
    }
    for (const c of chunks) {
      if (!c.active) c.el.style.height = estimateChunkHeight(c) + 'px';
    }
  };

  gridWindow = { done: true, renderMore() {}, virtualize, relayout };

  // First paint: fill the first chunk for real geometry, estimate the rest,
  // then run one recycle pass for whatever the viewport actually covers.
  fillChunk(chunks[0]);
  measureMetrics();
  for (let i = 1; i < chunks.length; i++) {
    chunks[i].el.style.height = estimateChunkHeight(chunks[i]) + 'px';
  }
  virtualize();
  return metrics ? metrics.cols : null;
}

// One global, time-throttled scroll listener appends the next batch as you near
// the bottom. A plain timestamp throttle (not requestAnimationFrame, which some
// embedded/background webviews pause) keeps it firing everywhere.
let _gridScrollAt = 0;
let _gridScrollPending = false;
function onGridScroll() {
  const now = Date.now();
  const since = now - _gridScrollAt;
  if (since < 90) {
    if (!_gridScrollPending) {
      _gridScrollPending = true;
      setTimeout(() => {
        _gridScrollPending = false;
        onGridScroll();
      }, 90 - since);
    }
    return;
  }
  _gridScrollAt = now;
  if (!gridWindow) return;
  if (!gridWindow.done && nearViewportBottom(1600)) gridWindow.renderMore();
  if (gridWindow.virtualize) gridWindow.virtualize();
}
window.addEventListener('scroll', onGridScroll, { passive: true });

// Measure the pinned bars so the sticky search/view-head stack has exact
// offsets (heights shift with fonts, viewport width, and theme).
function syncStickyHeights() {
  const tb = document.querySelector('.topbar');
  const tl = document.querySelector('.content .toolbar');
  const root = document.documentElement.style;
  if (tb) root.setProperty('--topbar-h', tb.offsetHeight + 'px');
  if (tl) root.setProperty('--toolbar-h', tl.offsetHeight + 'px');
}
syncStickyHeights();
window.addEventListener('load', syncStickyHeights);

// Resize changes tile geometry → spacer heights are stale. Re-estimate after
// the flurry settles, then let the grid recycle for the new layout.
let _gridResizeTimer = 0;
window.addEventListener(
  'resize',
  () => {
    clearTimeout(_gridResizeTimer);
    _gridResizeTimer = setTimeout(() => {
      syncStickyHeights();
      if (gridWindow && gridWindow.relayout) gridWindow.relayout();
      onGridScroll();
    }, 150);
  },
  { passive: true }
);

function renderDayGroups(list, host) {
  renderPhotoList(list, host, true);
}

function renderPersonOrPlace(list, opts) {
  currentList = list;
  const actions = [];
  if (opts.person) {
    actions.push(
      headBtn(opts.person.name ? 'Rename' : 'Add name', () => renamePersonPrompt(opts.person), {})
    );
  }
  if (list.length) actions.push(selectBtn());
  setHead(opts.title, list.length ? fmtCount(list.length) : '', {
    back: opts.back,
    actions,
  });
  el.grid.replaceChildren();
  if (list.length === 0) {
    showEmpty('generic');
    return;
  }
  hideEmpty();
  renderPhotoList(list, el.grid, false);
}

function renderPeople() {
  currentList = [];
  setHead('People', people && people.length ? fmtCount(people.length).replace('items', 'people').replace('item', 'person') : '');
  el.grid.replaceChildren();
  if (!people || people.length === 0) {
    showEmpty('people');
    return;
  }
  hideEmpty();
  const g = document.createElement('div');
  g.className = 'people-grid';
  for (const person of people) g.appendChild(makePersonTile(person));
  el.grid.appendChild(g);
}

function renderPlaces() {
  currentList = [];
  setHead('Places', places && places.length ? fmtCount(places.length).replace('items', 'places').replace('item', 'place') : '');
  el.grid.replaceChildren();
  if (!places || places.length === 0) {
    showEmpty('places');
    return;
  }
  hideEmpty();
  const g = document.createElement('div');
  g.className = 'cover-grid';
  for (const pl of places) {
    g.appendChild(
      makeCoverTile({
        title: pl.label,
        subtitle: fmtCount(pl.count),
        coverPhotoId: pl.coverPhotoId,
        icon: 'places',
        onClick: () => navigate({ kind: 'place', param: pl.label }),
      })
    );
  }
  el.grid.appendChild(g);
}

function renderAlbums() {
  currentList = [];
  const create = headBtn('New Album', () => createAlbumPrompt(), {
    primary: true,
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  });
  setHead('Albums', albums && albums.length ? fmtCount(albums.length).replace('items', 'albums').replace('item', 'album') : '', { actions: [create] });
  el.grid.replaceChildren();
  if (!albums || albums.length === 0) {
    showEmpty('albums');
    return;
  }
  hideEmpty();
  const g = document.createElement('div');
  g.className = 'cover-grid';
  for (const a of albums) {
    g.appendChild(
      makeCoverTile({
        title: a.name,
        subtitle: fmtCount(a.photoCount),
        coverPhotoId: a.coverPhotoId,
        icon: 'albums',
        onClick: () => navigate({ kind: 'album', param: a.id }),
      })
    );
  }
  el.grid.appendChild(g);
}

function renderAlbumDetail(albumId) {
  const album = (albums || []).find((a) => a.id === albumId);
  if (!album) {
    navigate({ kind: 'albums' });
    return;
  }
  // Resolve the album's ordered photoIds against the loaded library.
  const list = album.photoIds.map((id) => photoIndex.get(id)).filter(Boolean);
  currentList = list;

  const actions = [];
  if (list.length) actions.push(selectBtn());
  actions.push(
    headBtn('Rename', () => renameAlbumPrompt(album)),
    headBtn('Delete', () => deleteAlbumConfirm(album), { danger: true })
  );
  setHead(album.name, fmtCount(list.length), {
    back: { label: 'Albums', onClick: () => navigate({ kind: 'albums' }) },
    actions,
  });
  el.grid.replaceChildren();
  if (list.length === 0) {
    showEmpty('album');
    return;
  }
  hideEmpty();
  renderPhotoList(list, el.grid, false);
}

function renderDeleted(list) {
  currentList = list;
  const actions = [];
  if (list.length) {
    actions.push(selectBtn());
    actions.push(headBtn('Empty', () => emptyDeletedConfirm(), { danger: true }));
  }
  setHead('Recently Deleted', list.length ? fmtCount(list.length) : '', { actions });
  el.grid.replaceChildren();
  if (list.length === 0) {
    showEmpty('deleted');
    return;
  }
  hideEmpty();
  const note = document.createElement('div');
  note.className = 'deleted-note';
  note.textContent = 'Photos are removed forever after 30 days. Open one to restore or delete it now.';
  el.grid.appendChild(note);
  renderPhotoList(list, el.grid, false);
}

// ------------------------------------------------------------------ search

function renderSearch() {
  currentList = searchResults || [];
  const hasResults = searchResults && searchResults.length;
  setHead('Search', '', hasResults ? { actions: [selectBtn()] } : {});
  el.grid.replaceChildren();
  hideEmpty();
  if (!searchResults || searchResults.length === 0) {
    const none = document.createElement('div');
    none.className = 'search-empty';
    none.textContent = searching ? 'Searching…' : 'No results for “' + searchQuery + '”';
    el.grid.appendChild(none);
    return;
  }
  const group = document.createElement('section');
  group.className = 'day-group';
  const header = document.createElement('h2');
  header.className = 'day-header';
  header.textContent = searchResults.length + ' result' + (searchResults.length === 1 ? '' : 's');
  const g = document.createElement('div');
  g.className = 'day-grid';
  for (const p of searchResults) g.appendChild(makeTile(p));
  group.append(header, g);
  el.grid.appendChild(group);
}

/**
 * Semantic search via the AI indexer; falls back to a filename/date filter
 * over the visible library when the indexer isn't available.
 */
async function runSearch(raw) {
  searchQuery = (raw || '').trim();
  const seq = ++searchSeq;
  el.searchClear.classList.toggle('hidden', searchQuery.length === 0);
  if (!searchQuery) {
    searchResults = null;
    searching = false;
    renderNav();
    renderView();
    return;
  }
  searching = true;
  if (searchResults === null) searchResults = [];
  renderNav();
  renderSearch();

  let results = null;
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(searchQuery) + '&limit=150', {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (res.ok) results = (await res.json()).photos || [];
  } catch (e) {
    /* fall through to local filter */
  }
  if (seq !== searchSeq) return; // superseded by a newer keystroke

  if (!results) {
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    results = visiblePhotos().filter((p) => {
      const hay = (p.filename + ' ' + dayLabelOf(p.createdAt)).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  searching = false;
  searchResults = results;
  renderSearch();
}

function clearSearchInput() {
  clearTimeout(searchTimer); // cancel a debounced runSearch queued before navigation
  if (searchQuery || (el.searchInput && el.searchInput.value)) {
    el.searchInput.value = '';
    searchQuery = '';
    searchResults = null;
    searching = false;
    el.searchClear.classList.add('hidden');
  }
}

// ------------------------------------------------------------- empty states

const EMPTY = {
  library: { icon: 'library', title: 'No photos yet', text: 'Open Nook on your iPhone to back up your library.' },
  favorites: { icon: 'heart', title: 'No favorites', text: 'Tap the heart on a photo to keep it here.' },
  videos: { icon: 'video', title: 'No videos', text: 'Videos you back up will appear here.' },
  screenshots: { icon: 'screenshot', title: 'No screenshots', text: 'Screenshots you back up will appear here.' },
  live: { icon: 'live', title: 'No Live Photos', text: 'Live Photos you back up will appear here.' },
  panoramas: { icon: 'pano', title: 'No panoramas', text: 'Panoramas you back up will appear here.' },
  portrait: { icon: 'portrait', title: 'No portraits', text: 'Portrait photos you back up will appear here.' },
  people: { icon: 'people', title: 'No people yet', text: 'As your photos are indexed, faces are grouped into people here.' },
  places: { icon: 'places', title: 'No places yet', text: 'Photos with location data are grouped by place here.' },
  albums: { icon: 'albums', title: 'No albums yet', text: 'Create an album to organize your photos.' },
  album: { icon: 'albums', title: 'Empty album', text: 'Open a photo and use “Add to Album” to fill this album.' },
  hidden: { icon: 'hidden', title: 'Nothing hidden', text: 'Hidden photos are kept out of your library and shown only here.' },
  deleted: { icon: 'trash', title: 'Nothing deleted', text: 'Deleted photos wait here for 30 days before they’re removed forever.' },
  generic: { icon: 'library', title: 'Nothing here', text: '' },
};

function showEmpty(kind) {
  const e = EMPTY[kind] || EMPTY.generic;
  el.emptyGlyph.innerHTML = ICON[e.icon] || ICON.library;
  el.emptyTitle.textContent = e.title;
  el.emptyText.textContent = e.text;
  el.empty.classList.remove('hidden');
}
function hideEmpty() {
  el.empty.classList.add('hidden');
}

// ------------------------------------------------------------- lightbox UI

/** The list the lightbox pages over — the photos currently on screen. */
function viewList() {
  return currentList && currentList.length ? currentList : photos;
}

function currentPhoto() {
  const list = viewList();
  return list.find((p) => p.id === lbId) || photoIndex.get(lbId) || null;
}

function openLightbox(id) {
  lbId = id;
  el.lightbox.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  renderLightbox();
}

function closeLightbox() {
  lbId = null;
  lbStageKey = null;
  lbLoadSeq += 1; // cancel in-flight stage loads
  el.lbStage.replaceChildren(); // also stops any playing video
  el.lightbox.classList.add('hidden');
  // Keep the page locked if a modal is still open above the (now-closed) lightbox.
  if (el.modalRoot.classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

function lbStep(delta) {
  const list = viewList();
  if (lbId === null || list.length === 0) return;
  const i = list.findIndex((p) => p.id === lbId);
  const next = i < 0 ? 0 : (i + delta + list.length) % list.length;
  lbId = list[next].id;
  renderLightbox();
}

function metaRow(label, value) {
  const row = document.createElement('div');
  row.className = 'lb-row';
  const a = document.createElement('span');
  a.textContent = label;
  const b = document.createElement('span');
  b.textContent = value;
  row.append(a, b);
  return row;
}

function renderLbInfo(p) {
  const deleted = p.deletedAt != null;
  el.lbFilename.textContent = p.filename;

  const d = new Date(p.createdAt);
  el.lbDatetime.textContent =
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Core rows.
  el.lbRows.replaceChildren();
  el.lbRows.appendChild(
    metaRow('Type', p.mediaType === 'video' ? 'Video · ' + fmtDuration(p.duration) : 'Photo')
  );
  el.lbRows.appendChild(metaRow('Resolution', p.width + ' × ' + p.height));
  el.lbRows.appendChild(metaRow('Size', fmtSizeMB(p.bytes)));
  const kinds = [];
  if (p.favorite) kinds.push('Favorite');
  if (p.live) kinds.push('Live');
  if (p.portrait) kinds.push('Portrait');
  if (p.panorama) kinds.push('Panorama');
  if (p.screenshot) kinds.push('Screenshot');
  if (kinds.length) el.lbRows.appendChild(metaRow('Kind', kinds.join(', ')));

  // Camera / EXIF.
  el.lbExifRows.replaceChildren();
  const cam = [p.cameraMake, p.cameraModel].filter(Boolean).join(' ');
  if (cam) el.lbExifRows.appendChild(metaRow('Camera', cam));
  if (p.lensModel) el.lbExifRows.appendChild(metaRow('Lens', p.lensModel));
  const settings = [];
  if (p.fNumber) settings.push('ƒ/' + Number(p.fNumber).toFixed(1).replace(/\.0$/, ''));
  const exp = fmtExposure(p.exposureTime);
  if (exp) settings.push(exp);
  if (p.iso) settings.push('ISO ' + p.iso);
  if (p.focalLength) settings.push(Math.round(p.focalLength) + 'mm');
  if (settings.length) el.lbExifRows.appendChild(metaRow('Settings', settings.join(' · ')));
  el.lbExifSection.classList.toggle('hidden', el.lbExifRows.childElementCount === 0);

  // Location.
  el.lbLocRows.replaceChildren();
  if (p.latitude != null && p.longitude != null) {
    el.lbLocRows.appendChild(
      metaRow('Coordinates', p.latitude.toFixed(4) + ', ' + p.longitude.toFixed(4))
    );
    el.lbMapLink.href =
      'https://www.openstreetmap.org/?mlat=' + p.latitude + '&mlon=' + p.longitude + '#map=15/' + p.latitude + '/' + p.longitude;
    el.lbLocSection.classList.remove('hidden');
  } else {
    el.lbLocSection.classList.add('hidden');
  }

  // Backup status.
  if (deleted) {
    el.lbBackup.classList.add('pending');
    el.lbBackup.innerHTML = SVG_CLOCK + '<span></span>';
    const daysLeft = deletedDaysLeft(p.deletedAt);
    el.lbBackup.lastChild.textContent =
      daysLeft != null ? daysLeft + (daysLeft === 1 ? ' day left' : ' days left') : 'In Recently Deleted';
  } else if (p.uploadState === 'complete') {
    el.lbBackup.classList.remove('pending');
    el.lbBackup.innerHTML = SVG_CHECK + '<span></span>';
    el.lbBackup.lastChild.textContent = 'Backed up to ' + serverName;
  } else {
    el.lbBackup.classList.add('pending');
    el.lbBackup.innerHTML = SVG_CLOCK + '<span>Upload pending</span>';
  }

  renderLbActions(p, deleted);
}

function deletedDaysLeft(deletedAt) {
  const t = Date.parse(deletedAt);
  if (!t) return null;
  const left = 30 - Math.floor((Date.now() - t) / 86400000);
  return Math.max(0, left);
}

function actionBtn(cls, title, html, onClick, opts) {
  opts = opts || {};
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lb-act ' + cls + (opts.active ? ' active' : '');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = html;
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', onClick);
  return b;
}

function renderLbActions(p, deleted) {
  el.lbActions.replaceChildren();

  if (deleted) {
    el.lbActions.appendChild(
      actionBtn(
        'wide',
        'Restore',
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v3.5h3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Restore</span>',
        () => restorePhoto(p)
      )
    );
    el.lbActions.appendChild(
      actionBtn(
        'danger',
        'Delete permanently',
        ICON.trash,
        () => permanentDeleteConfirm(p)
      )
    );
    return;
  }

  // Favorite.
  el.lbActions.appendChild(
    actionBtn(
      'fav',
      p.favorite ? 'Remove from favorites' : 'Add to favorites',
      p.favorite ? SVG_HEART_FILL : SVG_HEART_OUTLINE,
      () => toggleFavorite(p),
      { active: !!p.favorite }
    )
  );
  // Add to album.
  el.lbActions.appendChild(
    actionBtn(
      'plain',
      'Add to album',
      '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M19 9v9.5A2.5 2.5 0 0 1 16.5 21H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 11.5h4M11.5 9.5v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      () => addToAlbumPrompt(p)
    )
  );
  // Hide / unhide.
  el.lbActions.appendChild(
    actionBtn(
      'plain',
      p.hidden ? 'Unhide' : 'Hide',
      p.hidden
        ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.8"/></svg>'
        : ICON.hidden,
      () => toggleHidden(p)
    )
  );
  // Download.
  el.lbActions.appendChild(
    actionBtn(
      'plain',
      'Download',
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      () => downloadCurrent(),
      { disabled: p.uploadState !== 'complete' }
    )
  );
  // Delete (soft).
  el.lbActions.appendChild(
    actionBtn('danger', 'Delete', ICON.trash, () => deletePhoto(p))
  );
}

function renderStage(p) {
  const seq = ++lbLoadSeq;
  el.lbStage.replaceChildren();

  if (p.mediaType === 'video' && p.uploadState === 'complete') {
    const wrap = document.createElement('div');
    wrap.className = 'lb-video-wrap';

    const video = document.createElement('video');
    video.className = 'lb-media';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.autoplay = true;
    // Native HTTP Range streaming (chunked) — never downloads the whole file.
    // Token rides in the query since <video> can't set an Authorization header.
    video.poster = mediaUrl(p.thumbUrl);
    video.src = mediaUrl(p.originalUrl);

    // Buffering overlay: visible until the video is playable.
    const loading = document.createElement('div');
    loading.className = 'lb-video-loading';
    loading.innerHTML = '<span class="spinner"></span><span>Loading video…</span>';
    const hide = () => loading.classList.add('hidden');
    video.addEventListener('canplay', hide);
    video.addEventListener('playing', hide);
    video.addEventListener('waiting', () => loading.classList.remove('hidden'));
    // If direct range-streaming fails (e.g. served straight from the origin,
    // which doesn't accept ?token), fall back once to an authed blob download.
    let fellBack = false;
    video.addEventListener('error', async () => {
      if (fellBack) {
        loading.classList.remove('hidden');
        loading.innerHTML = '<span>Could not load video</span>';
        return;
      }
      fellBack = true;
      loading.classList.remove('hidden');
      const u = await getBlobUrl('orig:' + p.id, p.originalUrl);
      if (seq === lbLoadSeq && u) {
        video.src = u;
        video.load && video.load();
      } else {
        loading.innerHTML = '<span>Could not load video</span>';
      }
    });

    wrap.append(video, loading);
    el.lbStage.appendChild(wrap);
    video.play?.().catch(() => {}); // autoplay may be blocked; controls still work
    return;
  }

  // Wrap with a spinner so there's no flash of alt text / broken-image icon while
  // the bytes load; the image fades in once decoded.
  const wrap = document.createElement('div');
  wrap.className = 'lb-img-wrap';
  const img = document.createElement('img');
  img.className = 'lb-media';
  img.alt = '';
  img.decoding = 'async';
  const loading = document.createElement('div');
  loading.className = 'lb-video-loading';
  loading.innerHTML = '<span class="spinner"></span>';
  wrap.append(img, loading);
  el.lbStage.appendChild(wrap);

  img.addEventListener('load', () => {
    img.classList.add('loaded');
    loading.classList.add('hidden');
  });

  let fullShown = false;
  // 1) A medium JPEG first (fast — resized from the stored thumbnail), so
  //    something appears almost instantly, including for HEIC.
  getBlobUrl('mid:' + p.id, p.thumbUrl + '?w=1024').then((u) => {
    if (seq === lbLoadSeq && u && !fullShown) img.src = u;
  });
  // 2) The full-resolution JPEG via /view (HEIC decoded server-side; others
  //    resized from the original). Falls back silently to the medium JPEG if the
  //    endpoint isn't available.
  if (p.uploadState === 'complete') {
    getBlobUrl('full:' + p.id, '/api/photos/' + p.id + '/view?w=3000').then((u) => {
      if (seq === lbLoadSeq && u) {
        fullShown = true;
        img.src = u;
      }
    });
  }
}

function renderLightbox() {
  const p = currentPhoto();
  if (!p) {
    closeLightbox();
    return;
  }
  renderLbInfo(p);
  const stageKey = p.id + ':' + p.uploadState;
  if (stageKey !== lbStageKey) {
    lbStageKey = stageKey;
    renderStage(p);
  }
}

// ---------------------------------------------------------------- actions

/** Replace a photo in `photos` (and any open detail list) with the server's copy. */
function applyPhotoUpdate(updated) {
  const i = photos.findIndex((x) => x.id === updated.id);
  if (i >= 0) photos[i] = updated;
  // Keep a fetched detail list (person/place/deleted) in sync so its tiles and
  // the lightbox reflect the new favorite/hidden state.
  if (view._photos) {
    const j = view._photos.findIndex((x) => x.id === updated.id);
    if (j >= 0) view._photos[j] = updated;
  }
  rebuildIndex();
  lastLibraryJson = null; // force a clean resync on the next poll
}

/** Remove a photo id from any cached album (matches the server's delete cascade). */
function pruneFromAlbums(photoId) {
  if (!albums) return;
  for (const a of albums) {
    const idx = a.photoIds.indexOf(photoId);
    if (idx >= 0) {
      a.photoIds.splice(idx, 1);
      a.photoCount = a.photoIds.length;
      if (a.coverPhotoId === photoId) a.coverPhotoId = a.photoIds[0] || null;
    }
  }
}

async function toggleFavorite(p) {
  try {
    const updated = await apiJson('/api/photos/' + p.id, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ favorite: !p.favorite }),
    });
    applyPhotoUpdate(updated);
    // Un-favoriting inside the Favorites view removes the photo from that list —
    // advance the lightbox off it before the grid rebuilds (else paging escapes
    // into the full library).
    if (view.kind === 'category' && view.param === 'favorites' && !updated.favorite) {
      stepOffCurrent();
    }
    afterPhotoMutation();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not update favorite');
  }
}

async function toggleHidden(p) {
  const willHide = !p.hidden;
  try {
    const updated = await apiJson('/api/photos/' + p.id, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ hidden: willHide }),
    });
    applyPhotoUpdate(updated);
    toast(willHide ? 'Photo hidden' : 'Photo unhidden');
    // Hiding removes it from the current (non-hidden) view; unhiding removes it
    // from the Hidden view. Drop it from any fetched detail list and advance the
    // lightbox off the now-absent photo.
    if ((view.kind !== 'hidden' && willHide) || (view.kind === 'hidden' && !willHide)) {
      if (view._photos) view._photos = view._photos.filter((x) => x.id !== p.id);
      stepOffCurrent();
    }
    afterPhotoMutation();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not update photo');
  }
}

async function deletePhoto(p) {
  try {
    await apiJson('/api/photos/' + p.id, { method: 'DELETE' });
    // Remove locally; it now lives in Recently Deleted.
    photos = photos.filter((x) => x.id !== p.id);
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== p.id);
    pruneFromAlbums(p.id); // server drops it from albums; keep cached counts/covers honest
    people = null; // face clusters may shift; refetched on next visit
    places = null; // place membership may shift
    rebuildIndex();
    lastLibraryJson = null;
    stepOffCurrent();
    toast('Moved to Recently Deleted');
    afterPhotoMutation();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not delete photo');
  }
}

async function restorePhoto(p) {
  try {
    await apiJson('/api/photos/' + p.id + '/restore', { method: 'POST' });
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== p.id);
    lastLibraryJson = null;
    people = null; // the restored photo re-enters clusters/places
    places = null;
    stepOffCurrent();
    toast('Photo restored');
    afterPhotoMutation(); // repaint grid + lightbox (onto the neighbor)
    tick(); // pull the restored photo back into the library
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not restore photo');
  }
}

async function permanentDeleteConfirm(p) {
  const ok = await confirmModal({
    title: 'Delete permanently?',
    body: 'This photo will be removed from your server forever. This cannot be undone.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson('/api/photos/' + p.id + '/permanent', { method: 'DELETE' });
    if (view._photos) view._photos = view._photos.filter((x) => x.id !== p.id);
    stepOffCurrent();
    toast('Photo deleted');
    afterPhotoMutation(); // repaint grid + lightbox (onto the neighbor, or close)
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not delete photo');
  }
}

async function emptyDeletedConfirm() {
  const ok = await confirmModal({
    title: 'Empty Recently Deleted?',
    body: 'All photos here will be removed from your server forever. This cannot be undone.',
    confirm: 'Empty',
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson('/api/deleted', { method: 'DELETE' });
    view._photos = [];
    toast('Recently Deleted emptied');
    renderView();
    tick();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not empty');
  }
}

/** After the open photo leaves the current list, advance or close the lightbox. */
function stepOffCurrent() {
  if (lbId === null) return;
  const list = viewList();
  const i = list.findIndex((p) => p.id === lbId);
  const remaining = list.filter((p) => p.id !== lbId);
  if (remaining.length === 0) {
    closeLightbox();
    return;
  }
  const nextIdx = Math.min(i < 0 ? 0 : i, remaining.length - 1);
  lbId = remaining[nextIdx].id;
}

/** Re-render nav counts + the current view + the (possibly changed) lightbox. */
function afterPhotoMutation() {
  renderNav();
  renderView();
  if (lbId !== null && !el.lightbox.classList.contains('hidden')) renderLightbox();
}

async function downloadCurrent() {
  const p = currentPhoto();
  if (!p || p.uploadState !== 'complete') return;
  const url = await getBlobUrl('orig:' + p.id, p.originalUrl);
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = p.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --------------------------------------------------------- album mutations

async function createAlbumPrompt() {
  const name = await promptModal({ title: 'New Album', placeholder: 'Album name', confirm: 'Create' });
  if (!name) return;
  try {
    const album = await apiJson('/api/albums', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    albums = [album].concat(albums || []);
    renderNav();
    navigate({ kind: 'album', param: album.id });
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not create album');
  }
}

async function renameAlbumPrompt(album) {
  const name = await promptModal({ title: 'Rename Album', placeholder: 'Album name', value: album.name, confirm: 'Save' });
  if (!name || name === album.name) return;
  try {
    const updated = await apiJson('/api/albums/' + album.id, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    replaceAlbum(updated);
    renderView();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not rename album');
  }
}

async function deleteAlbumConfirm(album) {
  const ok = await confirmModal({
    title: 'Delete “' + album.name + '”?',
    body: 'The album is removed. Your photos are not deleted.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await apiJson('/api/albums/' + album.id, { method: 'DELETE' });
    albums = (albums || []).filter((a) => a.id !== album.id);
    navigate({ kind: 'albums' });
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not delete album');
  }
}

function replaceAlbum(updated) {
  if (!albums) return;
  const i = albums.findIndex((a) => a.id === updated.id);
  if (i >= 0) albums[i] = updated;
}

async function addToAlbumPrompt(photo) {
  if (!albums) await loadAlbums();
  const choice = await albumPickerModal(photo);
  if (!choice) return;
  let albumId = choice.albumId;
  try {
    if (choice.createName) {
      const created = await apiJson('/api/albums', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: choice.createName }),
      });
      albums = [created].concat(albums || []);
      albumId = created.id;
    }
    const updated = await apiJson('/api/albums/' + albumId, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ addPhotoIds: [photo.id] }),
    });
    replaceAlbum(updated);
    renderNav();
    toast('Added to “' + updated.name + '”');
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not add to album');
  }
}

// ------------------------------------------------------------ person rename

async function renamePersonPrompt(person) {
  const name = await promptModal({
    title: person.name ? 'Rename Person' : 'Name this person',
    placeholder: 'Name',
    value: person.name || '',
    confirm: 'Save',
  });
  if (name === null) return;
  try {
    await apiJson('/api/people/' + encodeURIComponent(person.id), {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    person.name = name;
    if (people) {
      const m = people.find((x) => x.id === person.id);
      if (m) m.name = name;
    }
    if (view.kind === 'person' && view._person && view._person.id === person.id) view._person.name = name;
    renderView();
    toast(name ? 'Renamed' : 'Name removed');
  } catch (err) {
    if (err.message !== 'unauthorized') toast('Could not rename');
  }
}

// -------------------------------------------------------------------- toast

let toastTimer = null;
function toast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => el.toast.classList.add('hidden'), 250);
  }, 2200);
}

// ------------------------------------------------------------------- modals

let modalResolve = null;

function openModal(card) {
  closeModalImmediate();
  el.modalCard.replaceChildren(card);
  el.modalRoot.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  const focusable = el.modalCard.querySelector('input, button');
  if (focusable) setTimeout(() => focusable.focus(), 30);
}

function closeModal(value) {
  const r = modalResolve;
  modalResolve = null;
  closeModalImmediate();
  if (r) r(value);
}

function closeModalImmediate() {
  el.modalRoot.classList.add('hidden');
  el.modalCard.replaceChildren();
  if (lbId === null) document.body.classList.remove('no-scroll');
}

function modalShell(title) {
  const wrap = document.createElement('div');
  wrap.className = 'm-wrap';
  const h = document.createElement('div');
  h.className = 'm-title';
  h.textContent = title;
  wrap.appendChild(h);
  return wrap;
}

function modalButtons(wrap, opts) {
  const row = document.createElement('div');
  row.className = 'm-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'm-btn';
  cancel.textContent = opts.cancel || 'Cancel';
  cancel.addEventListener('click', () => closeModal(opts.cancelValue !== undefined ? opts.cancelValue : null));
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'm-btn primary' + (opts.danger ? ' danger' : '');
  confirm.textContent = opts.confirm || 'OK';
  confirm.addEventListener('click', opts.onConfirm);
  row.append(cancel, confirm);
  wrap.appendChild(row);
  return { confirm, cancel };
}

function promptModal(opts) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const wrap = modalShell(opts.title);
    const input = document.createElement('input');
    input.className = 'm-input';
    input.type = opts.password ? 'password' : 'text';
    if (opts.password) input.autocapitalize = 'none';
    input.placeholder = opts.placeholder || '';
    input.value = opts.value || '';
    input.autocomplete = 'off';
    wrap.appendChild(input);
    const submit = () => closeModal(input.value.trim());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    modalButtons(wrap, { confirm: opts.confirm, onConfirm: submit });
    openModal(wrap);
    setTimeout(() => input.select(), 40);
  });
}

function confirmModal(opts) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const wrap = modalShell(opts.title);
    if (opts.body) {
      const p = document.createElement('p');
      p.className = 'm-body';
      p.textContent = opts.body;
      wrap.appendChild(p);
    }
    modalButtons(wrap, {
      confirm: opts.confirm,
      danger: opts.danger,
      cancelValue: false,
      onConfirm: () => closeModal(true),
    });
    openModal(wrap);
  });
}

/** Pick an existing album or create a new one to add a photo to. */
function albumPickerModal(photo) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const wrap = modalShell('Add to Album');
    const list = document.createElement('div');
    list.className = 'm-list';

    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className = 'm-row m-row-new';
    newRow.innerHTML =
      '<span class="m-row-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span><span>New Album…</span>';
    newRow.addEventListener('click', async () => {
      const name = await promptModal({ title: 'New Album', placeholder: 'Album name', confirm: 'Create' });
      // promptModal reused modalResolve; re-arm ours and resolve in BOTH paths so
      // a cancelled "New Album" never leaves addToAlbumPrompt awaiting forever.
      modalResolve = resolve;
      closeModal(name ? { createName: name } : null);
    });
    list.appendChild(newRow);

    for (const a of albums || []) {
      const has = a.photoIds.indexOf(photo.id) !== -1;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'm-row';
      row.disabled = has;
      row.innerHTML =
        '<span class="m-row-ico">' + ICON.albums + '</span><span class="m-row-name"></span>' +
        (has ? '<span class="m-row-in">Added</span>' : '');
      row.querySelector('.m-row-name').textContent = a.name;
      if (!has) row.addEventListener('click', () => closeModal({ albumId: a.id }));
      list.appendChild(row);
    }
    wrap.appendChild(list);

    const row = document.createElement('div');
    row.className = 'm-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'm-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => closeModal(null));
    row.appendChild(cancel);
    wrap.appendChild(row);
    openModal(wrap);
  });
}

// ----------------------------------------------------- account & users UI

async function openAccount() {
  let account = currentUser;
  try {
    account = await apiJson('/api/account');
    currentUser = account;
    localStorage.setItem('nookUser', JSON.stringify(account));
    renderUser();
  } catch (e) {
    /* use cached */
  }
  const wrap = modalShell('Account');
  const form = document.createElement('div');
  form.className = 'm-form';

  const nameF = field('Name', 'text', account.displayName || '');
  const emailF = field('Email', 'email', account.email || '');
  form.append(nameF.wrap, emailF.wrap);

  const roleLine = document.createElement('div');
  roleLine.className = 'm-note';
  roleLine.textContent = '@' + (account.username || '') + (account.role === 'admin' ? ' · Administrator' : '');
  form.appendChild(roleLine);

  const pwTitle = document.createElement('div');
  pwTitle.className = 'm-subtitle';
  pwTitle.textContent = 'Change password';
  form.appendChild(pwTitle);
  const curF = field('Current password', 'password', '');
  const newF = field('New password', 'password', '');
  form.append(curF.wrap, newF.wrap);

  wrap.appendChild(form);

  const err = document.createElement('div');
  err.className = 'm-error hidden';
  wrap.appendChild(err);

  // Admin: manage users.
  if (account.role === 'admin') {
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'm-link';
    manage.textContent = 'Manage users →';
    manage.addEventListener('click', () => { closeModalImmediate(); openUsers(); });
    wrap.appendChild(manage);
  }

  modalResolve = null; // this modal manages its own lifecycle
  const btns = modalButtons(wrap, {
    confirm: 'Save',
    onConfirm: async () => {
      err.classList.add('hidden');
      const body = {};
      if (nameF.input.value.trim() && nameF.input.value.trim() !== (account.displayName || ''))
        body.displayName = nameF.input.value.trim();
      if (emailF.input.value.trim() !== (account.email || '')) body.email = emailF.input.value.trim();
      if (newF.input.value) {
        body.newPassword = newF.input.value;
        body.currentPassword = curF.input.value;
      }
      if (Object.keys(body).length === 0) { closeModalImmediate(); return; }
      btns.confirm.disabled = true;
      try {
        const updated = await apiJson('/api/account', {
          method: 'PATCH',
          headers: jsonHeaders(),
          body: JSON.stringify(body),
        });
        currentUser = updated;
        localStorage.setItem('nookUser', JSON.stringify(updated));
        renderUser();
        closeModalImmediate();
        toast('Account updated');
      } catch (e2) {
        btns.confirm.disabled = false;
        err.textContent = e2.message || 'Could not update account';
        err.classList.remove('hidden');
      }
    },
  });
  openModal(wrap);
}

async function openUsers() {
  const wrap = modalShell('Users');
  const list = document.createElement('div');
  list.className = 'm-list';
  list.innerHTML = '<div class="m-note">Loading…</div>';
  wrap.appendChild(list);

  const addRow = document.createElement('button');
  addRow.type = 'button';
  addRow.className = 'm-link';
  addRow.textContent = '+ Add user';
  addRow.addEventListener('click', () => { closeModalImmediate(); addUserFlow(); });
  wrap.appendChild(addRow);

  const row = document.createElement('div');
  row.className = 'm-buttons';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'm-btn';
  back.textContent = 'Done';
  back.addEventListener('click', () => closeModalImmediate());
  row.appendChild(back);
  wrap.appendChild(row);
  openModal(wrap);

  try {
    const j = await apiJson('/api/users');
    const users = (j && j.users) || [];
    list.replaceChildren();
    for (const u of users) {
      const r = document.createElement('div');
      r.className = 'm-user';
      const info = document.createElement('div');
      info.className = 'm-user-info';
      info.innerHTML = '<div class="m-user-name"></div><div class="m-user-sub"></div>';
      info.querySelector('.m-user-name').textContent = u.displayName || u.username;
      info.querySelector('.m-user-sub').textContent =
        '@' + u.username + (u.role === 'admin' ? ' · admin' : '');
      r.appendChild(info);
      if (currentUser && u.id !== currentUser.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'm-user-del';
        del.innerHTML = ICON.trash;
        del.title = 'Delete user';
        del.addEventListener('click', async () => {
          const ok = await confirmModal({
            title: 'Delete ' + (u.displayName || u.username) + '?',
            body: 'Their photos and albums are removed from the server. This cannot be undone.',
            confirm: 'Delete',
            danger: true,
          });
          if (!ok) { openUsers(); return; }
          try {
            await apiJson('/api/users/' + u.id, { method: 'DELETE' });
            toast('User deleted');
          } catch (e) {
            if (e.message !== 'unauthorized') toast(e.message || 'Could not delete user');
          }
          openUsers();
        });
        r.appendChild(del);
      }
      list.appendChild(r);
    }
    if (users.length === 0) list.innerHTML = '<div class="m-note">No users.</div>';
  } catch (e) {
    list.innerHTML = '<div class="m-note">Could not load users.</div>';
  }
}

async function addUserFlow() {
  const wrap = modalShell('Add User');
  const form = document.createElement('div');
  form.className = 'm-form';
  const nameF = field('Name', 'text', '');
  const userF = field('Username', 'text', '');
  const passF = field('Password', 'password', '');
  form.append(nameF.wrap, userF.wrap, passF.wrap);
  wrap.appendChild(form);
  const err = document.createElement('div');
  err.className = 'm-error hidden';
  wrap.appendChild(err);
  const btns = modalButtons(wrap, {
    confirm: 'Create',
    onConfirm: async () => {
      err.classList.add('hidden');
      const body = {
        displayName: nameF.input.value.trim(),
        username: userF.input.value.trim(),
        password: passF.input.value,
      };
      if (!body.displayName || !body.username || !body.password) {
        err.textContent = 'All fields are required.';
        err.classList.remove('hidden');
        return;
      }
      btns.confirm.disabled = true;
      try {
        await apiJson('/api/users', {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify(body),
        });
        toast('User created');
        openUsers();
      } catch (e) {
        btns.confirm.disabled = false;
        err.textContent = e.message || 'Could not create user';
        err.classList.remove('hidden');
      }
    },
  });
  openModal(wrap);
}

function field(label, type, value) {
  const wrap = document.createElement('label');
  wrap.className = 'm-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.autocomplete = type === 'password' ? 'new-password' : 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  wrap.append(span, input);
  return { wrap, input };
}

// ---------------------------------------------------------------- events

let searchTimer = null;
el.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const value = el.searchInput.value;
  el.searchClear.classList.toggle('hidden', value.trim().length === 0);
  searchTimer = setTimeout(() => runSearch(value), 300);
});
el.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    el.searchInput.value = '';
    runSearch('');
  }
});
el.searchClear.addEventListener('click', () => {
  el.searchInput.value = '';
  runSearch('');
  el.searchInput.focus();
});

el.navToggle.addEventListener('click', () => {
  if (el.sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
});
el.sidebarScrim.addEventListener('click', closeSidebar);
el.miniServer.addEventListener('click', openAccount);
el.accountBtn.addEventListener('click', openAccount);

el.lbClose.addEventListener('click', closeLightbox);
el.lbBackdrop.addEventListener('click', closeLightbox);
el.lbPrev.addEventListener('click', () => lbStep(-1));
el.lbNext.addEventListener('click', () => lbStep(1));

el.modalBackdrop.addEventListener('click', () => {
  if (modalResolve) closeModal(null);
  else closeModalImmediate();
});

document.addEventListener('keydown', (e) => {
  if (!el.modalRoot.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      if (modalResolve) closeModal(null);
      else closeModalImmediate();
    }
    return;
  }
  if (lbId === null) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lbStep(-1);
  else if (e.key === 'ArrowRight') lbStep(1);
});

// ------------------------------------------------------------ brand loader

let bootLoaderDone = false;

function dismissBootLoader() {
  if (bootLoaderDone || !el.bootLoader) return;
  bootLoaderDone = true;
  el.bootLoader.classList.add('fade-out');
  setTimeout(() => el.bootLoader.classList.add('hidden'), 500);
}

let pillLoaderTimer = null;

function pillLoaderFetchStarted() {
  if (!el.pillLoader || pillLoaderTimer !== null) return;
  pillLoaderTimer = setTimeout(() => {
    pillLoaderTimer = null;
    el.pillLoader.classList.remove('hidden');
  }, 300);
}

function pillLoaderFetchEnded() {
  if (pillLoaderTimer !== null) {
    clearTimeout(pillLoaderTimer);
    pillLoaderTimer = null;
  }
  if (el.pillLoader) el.pillLoader.classList.add('hidden');
}

// -------------------------------------------------------------- auth screen

function showAuthError(msg) {
  el.authError.textContent = msg;
  el.authError.classList.remove('hidden');
}

function hideAuthError() {
  el.authError.textContent = '';
  el.authError.classList.add('hidden');
}

function setAuthBusy(busy) {
  authBusy = busy;
  el.authSubmit.disabled = busy;
  el.authSubmit.textContent = busy
    ? authMode === 'setup'
      ? 'Creating…'
      : 'Signing in…'
    : authMode === 'setup'
    ? 'Create admin account'
    : 'Sign in';
}

function applyAuthMode() {
  if (authMode === 'setup') {
    el.authTitle.textContent = 'Create your admin account';
    el.authSub.textContent =
      'This Nook server is brand new. The first account you create becomes its administrator.';
    el.fieldDisplayName.classList.remove('hidden');
    el.fieldEmail.classList.remove('hidden');
    el.authPassword.setAttribute('autocomplete', 'new-password');
  } else {
    el.authTitle.textContent = 'Sign in';
    el.authSub.textContent = 'Sign in to your Nook account to see your library.';
    el.fieldDisplayName.classList.add('hidden');
    el.fieldEmail.classList.add('hidden');
    el.authPassword.setAttribute('autocomplete', 'current-password');
  }
  setAuthBusy(false);
}

async function showLogin() {
  el.userChip.classList.add('hidden');
  let setupRequired = false;
  try {
    const res = await fetch('/api/ping');
    if (res.ok) {
      const j = await res.json();
      setupRequired = !!j.setupRequired;
    }
  } catch (err) {
    /* server unreachable — default to the sign-in form */
  }
  authMode = setupRequired ? 'setup' : 'login';
  applyAuthMode();
  hideAuthError();
  el.authScreen.classList.remove('hidden');
  dismissBootLoader();
  const first = authMode === 'setup' ? el.authDisplayName : el.authUsername;
  try {
    first.focus();
  } catch (err) {
    /* focus is best-effort */
  }
}

function startSession(tok, user) {
  token = tok;
  currentUser = user || null;
  localStorage.setItem('nookToken', tok);
  if (user) localStorage.setItem('nookUser', JSON.stringify(user));

  el.authForm.reset();
  hideAuthError();
  setAuthBusy(false);
  el.authScreen.classList.add('hidden');

  resetAppState();
  renderUser();
  loadServerInfo();
  navigate(hashToView(location.hash));
  tick();
}

function resetAppState() {
  lastLibraryJson = null;
  lastStatusJson = null;
  photos = [];
  rebuildIndex();
  albums = null;
  people = null;
  places = null;
  aiEnabled = false; // re-primed by loadServerInfo; don't leak across servers/sessions
  view = { kind: 'library' };
  privateUnlocked = false; // re-lock Hidden / Recently Deleted for the new session
  currentList = [];
  clearSearchInput();
  online = false;
}

function clearSession() {
  token = null;
  currentUser = null;
  localStorage.removeItem('nookToken');
  localStorage.removeItem('nookUser');
  flushBlobCache();
  resetAppState();
  if (lbId !== null) closeLightbox();
  closeModalImmediate();
  el.grid.replaceChildren();
  el.viewHead.replaceChildren();
  hideEmpty();
  el.userChip.classList.add('hidden');
}

function handleUnauthorized() {
  if (!token) return; // already handled
  clearSession();
  showLogin();
}

async function onAuthSubmit(e) {
  e.preventDefault();
  if (authBusy) return;
  hideAuthError();

  const username = el.authUsername.value.trim();
  const password = el.authPassword.value;
  if (!username || !password) {
    showAuthError('Enter your username and password.');
    return;
  }

  let url;
  let body;
  if (authMode === 'setup') {
    const displayName = el.authDisplayName.value.trim();
    const email = el.authEmail.value.trim();
    if (!displayName) {
      showAuthError('Enter a name for your account.');
      return;
    }
    url = '/api/setup';
    body = { username, password, displayName };
    if (email) body.email = email;
  } else {
    url = '/api/login';
    body = { username, password };
  }

  setAuthBusy(true);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data && data.token) {
      startSession(data.token, data.user);
      return;
    }

    if (authMode === 'setup' && res.status === 409) {
      authMode = 'login';
      applyAuthMode();
      showAuthError('This server has already been set up. Sign in with your account.');
      return;
    }

    setAuthBusy(false);
    const fallback =
      authMode === 'setup' ? 'Could not create the account.' : 'Invalid username or password.';
    showAuthError((data && data.error) || fallback);
  } catch (err) {
    setAuthBusy(false);
    showAuthError('Could not reach the server. Check your connection and try again.');
  }
}

async function signOut() {
  const tok = token;
  clearSession();
  await showLogin();
  if (tok) {
    fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).catch(
      () => {}
    );
  }
}

el.authForm.addEventListener('submit', onAuthSubmit);
el.signoutBtn.addEventListener('click', signOut);

// ----------------------------------------------------------- server info

/** Prime the server name + AI flag from the public GET /api/server. */
async function loadServerInfo() {
  try {
    const res = await fetch('/api/server');
    if (!res.ok) return;
    const s = await res.json();
    if (s && s.name) {
      serverName = s.name;
      el.miniServerName.textContent = s.name;
    }
    const wasAi = aiEnabled;
    aiEnabled = !!(s && s.ai);
    if (aiEnabled !== wasAi) renderNav();
  } catch (err) {
    /* ignore — the status poll will fill this in */
  }
}

// ----------------------------------------------------------------- polling

async function tick() {
  if (!token) return; // not signed in; nothing to poll
  pillLoaderFetchStarted();
  try {
    const [statusRes, libraryRes] = await Promise.all([
      fetch('/api/status', { headers: authHeaders() }),
      fetch('/api/library', { headers: authHeaders() }),
    ]);

    if (statusRes.status === 401 || libraryRes.status === 401) {
      pillLoaderFetchEnded();
      handleUnauthorized();
      return;
    }
    if (!statusRes.ok || !libraryRes.ok) {
      throw new Error('poll failed: ' + statusRes.status + '/' + libraryRes.status);
    }

    const statusText = await statusRes.text();
    const libraryText = await libraryRes.text();
    online = true;

    if (statusText !== lastStatusJson) {
      lastStatusJson = statusText;
      renderStatus(JSON.parse(statusText));
    }

    if (libraryText !== lastLibraryJson) {
      lastLibraryJson = libraryText;
      photos = JSON.parse(libraryText).photos || [];
      rebuildIndex();
      renderNav();
      // Library-derived views re-render directly; fetched detail views
      // (person/place) get a guarded re-fetch so they don't go stale.
      if (searchResults === null && LIBRARY_VIEWS.has(view.kind)) {
        renderView();
      } else if (view.kind === 'album') {
        renderView(); // album detail resolves ids against the fresh library
      } else if (searchResults === null && (view.kind === 'person' || view.kind === 'place')) {
        const seq = renderSeq;
        const kind = view.kind;
        const url =
          kind === 'person'
            ? '/api/people/' + encodeURIComponent(view.param) + '/photos'
            : '/api/place-photos?label=' + encodeURIComponent(view.param);
        fetchPhotos(url)
          .then((ph) => {
            if (seq === renderSeq && view.kind === kind) {
              view._photos = ph;
              renderView();
              if (lbId !== null && !el.lightbox.classList.contains('hidden')) renderLightbox();
            }
          })
          .catch(() => {});
      }
      if (lbId !== null && !el.lightbox.classList.contains('hidden')) renderLightbox();
    }

    dismissBootLoader();
  } catch (err) {
    online = false;
    el.miniServerSub.textContent = 'Reconnecting…';
  }
  pillLoaderFetchEnded();
  updatePill();
}

const LIBRARY_VIEWS = new Set(['library', 'category', 'hidden']);

// -------------------------------------------------------------------- boot

// ------------------------------------------------------------------ theme
// Cycle dark -> light -> system. Persisted; the head inline-script applies it
// pre-paint, this keeps the toggle icon in sync and reacts to OS changes.
const THEME_ORDER = ['dark', 'light', 'system'];
const THEME_ICONS = {
  dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.2M12 18.8V21M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M3 12h2.2M18.8 12H21M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 20h6M12 16.5V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

function themePref() {
  return localStorage.getItem('nookTheme') || 'dark';
}
function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme() {
  const pref = themePref();
  document.documentElement.setAttribute('data-theme', resolveTheme(pref));
  if (el.themeToggle) {
    el.themeToggle.innerHTML = THEME_ICONS[pref] || THEME_ICONS.dark;
    el.themeToggle.title = 'Theme: ' + pref[0].toUpperCase() + pref.slice(1);
  }
}
function cycleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(themePref()) + 1) % THEME_ORDER.length];
  localStorage.setItem('nookTheme', next);
  applyTheme();
  toast('Theme: ' + next);
}
if (el.themeToggle) el.themeToggle.addEventListener('click', cycleTheme);
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (themePref() === 'system') applyTheme();
  });
}
applyTheme();

// ---------------------------------------------------- grid density zoom
// Photos-app style: pinch (a trackpad pinch arrives as wheel+ctrlKey, touch
// pinch handled below) or Ctrl+scroll over the photo grid steps the tile size.
// Persisted; only active when a photo grid is on screen so browser page-zoom
// still works everywhere else.
const GRID_ZOOM_LEVELS = [110, 140, 180, 230, 290, 360];

function gridZoomIndex() {
  const i = parseInt(localStorage.getItem('nookGridZoom'), 10);
  return Number.isInteger(i) ? Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, i)) : 2;
}

function applyGridZoom() {
  document.documentElement.style.setProperty('--tile-min', GRID_ZOOM_LEVELS[gridZoomIndex()] + 'px');
}

function setGridZoom(next) {
  const clamped = Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, next));
  if (clamped === gridZoomIndex()) return;
  localStorage.setItem('nookGridZoom', String(clamped));
  applyGridZoom();
  // New tile size → chunk heights changed. Re-estimate spacers, then let the
  // grid window top up / recycle for the new layout.
  setTimeout(() => {
    if (gridWindow && gridWindow.relayout) gridWindow.relayout();
    onGridScroll();
  }, 60);
}

let _gridZoomAccum = 0;
el.content.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch reports ctrlKey
    if (!el.grid.querySelector('.day-grid')) return;
    e.preventDefault(); // keep the browser from page-zooming over the grid
    _gridZoomAccum += e.deltaY;
    if (Math.abs(_gridZoomAccum) < 25) return;
    const zoomIn = _gridZoomAccum < 0; // pinch out / scroll up = bigger tiles
    _gridZoomAccum = 0;
    setGridZoom(gridZoomIndex() + (zoomIn ? 1 : -1));
  },
  { passive: false }
);

// Touchscreen two-finger pinch.
let _pinchStartDist = 0;
let _pinchStartIdx = 0;
function _touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}
el.content.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2 && el.grid.querySelector('.day-grid')) {
      _pinchStartDist = _touchDist(e.touches);
      _pinchStartIdx = gridZoomIndex();
    }
  },
  { passive: true }
);
el.content.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length !== 2 || !_pinchStartDist) return;
    if (!el.grid.querySelector('.day-grid')) return;
    e.preventDefault();
    const steps = Math.round(Math.log2(_touchDist(e.touches) / _pinchStartDist) * 2);
    setGridZoom(_pinchStartIdx + steps);
  },
  { passive: false }
);
el.content.addEventListener('touchend', () => { _pinchStartDist = 0; }, { passive: true });

applyGridZoom();

function start() {
  renderUser();
  if (token) {
    loadServerInfo();
    navigate(hashToView(location.hash)); // restore the view from the URL on reload
    tick();
  } else {
    showLogin();
  }
  setInterval(tick, POLL_MS);
}

start();
