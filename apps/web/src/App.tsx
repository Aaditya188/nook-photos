/**
 * App shell: providers, router, topbar/sidebar/toolbar chrome, boot loader,
 * search overlay, lightbox, and the add-to-album flow.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PhotoRecord } from '@nook/core';
import { AuthProvider, useAuth } from './state/auth';
import { ModalProvider, ToastProvider, useModals, useToast } from './state/ui';
import { ViewProvider, useView, type SearchFilters } from './state/view';
import {
  useActions,
  useAlbumsQ,
  useLibraryQ,
  usePeopleQ,
  usePlacesQ,
  useServerInfoQ,
  useStatusQ,
} from './state/data';
import { useStickyHeights } from './hooks/useStickyHeights';
import { useGridZoomGestures } from './hooks/useGridZoom';
import { dayLabelOf } from './lib/format';
import { AuthScreen } from './components/AuthScreen';
import { BootLoader, Sidebar, TopBar, type NavGroup } from './components/chrome';
import { Lightbox } from './components/Lightbox';
import { useAccountModals } from './components/AccountModals';
import {
  AlbumView,
  AlbumsView,
  CATEGORIES,
  CATEGORY_ORDER,
  CategoryView,
  DeletedView,
  HiddenView,
  LibraryView,
  PeopleView,
  PersonView,
  PlaceView,
  PlacesView,
  SearchResults,
} from './views/views';
import { Onboarding } from './views/Onboarding';
import { SharedAlbum } from './views/SharedAlbum';
import { BackupHealthView } from './views/BackupHealth';

// Leaflet is heavy — the map route loads on demand.
const MapView = lazy(() => import('./views/MapView').then((m) => ({ default: m.MapView })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            {/* Modal cards + ViewProvider both need router context (navigation
                from modals; the lightbox lives in the URL). */}
            <ModalProvider>
              <ViewProvider>
                <HashRedirect />
                <Root />
              </ViewProvider>
            </ModalProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

/** Old #/x links (vanilla dashboard) → real routes. */
function HashRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    const h = window.location.hash;
    if (h && h.startsWith('#/')) {
      const path = h.slice(1);
      window.history.replaceState(null, '', path || '/');
      nav(path || '/', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Root() {
  const { token } = useAuth();
  const location = useLocation();
  // Public shared-album pages need no account.
  if (location.pathname.startsWith('/s/')) {
    return (
      <Routes>
        <Route path="/s/:sid" element={<SharedAlbum />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  if (!token) return <AuthScreen />;
  return <Shell />;
}

function Shell() {
  const { user, privateUnlocked } = useAuth();
  const statusQ = useStatusQ();
  const libQ = useLibraryQ();
  const serverQ = useServerInfoQ();
  const albumsQ = useAlbumsQ();
  const aiEnabled = !!serverQ.data?.ai;
  const peopleQ = usePeopleQ(aiEnabled);
  const placesQ = usePlacesQ(aiEnabled);
  const { openAccount } = useAccountModals();
  const [navOpen, setNavOpen] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);
  const location = useLocation();

  useStickyHeights();
  useGridZoomGestures(contentRef);

  const photos = libQ.data || [];
  const visible = useMemo(() => photos.filter((p) => !p.hidden), [photos]);
  const hiddenCount = photos.length - visible.length;
  const pending = photos.reduce((n, p) => n + (p.uploadState === 'pending' ? 1 : 0), 0);
  const online = !statusQ.isError && (statusQ.isSuccess || statusQ.isFetching);
  const serverName = statusQ.data?.server?.name || serverQ.data?.name || 'nook.local';

  // Boot loader until the first library payload lands.
  const [booted, setBooted] = useState(false);
  const [bootFading, setBootFading] = useState(false);
  useEffect(() => {
    if (!booted && (libQ.isSuccess || libQ.isError)) {
      setBootFading(true);
      const t = setTimeout(() => setBooted(true), 500);
      return () => clearTimeout(t);
    }
  }, [booted, libQ.isSuccess, libQ.isError]);

  // A fresh admin signup lands in the onboarding guide once.
  const navigate = useNavigate();
  useEffect(() => {
    if (localStorage.getItem('nookShowOnboarding') === '1') {
      localStorage.removeItem('nookShowOnboarding');
      navigate('/welcome', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving a view drops selection + search.
  const { exitSelect, searchResults, setSearchState } = useView();
  const prevPath = useRef(location.pathname);
  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      prevPath.current = location.pathname;
      exitSelect();
      window.scrollTo(0, 0);
    }
  }, [location.pathname, exitSelect]);

  const navGroups = useMemo<NavGroup[]>(() => {
    const primary = [{ to: '/', title: 'Library', icon: 'library', count: visible.length }];
    for (const key of CATEGORY_ORDER) {
      const n = visible.filter(CATEGORIES[key].test).length;
      if (key === 'favorites' || n > 0) {
        primary.push({ to: '/category/' + key, title: CATEGORIES[key].title, icon: CATEGORIES[key].icon, count: n });
      }
    }
    const groups: NavGroup[] = [{ items: primary }];
    const hasGps = visible.some((p) => p.latitude != null && p.longitude != null);
    if (aiEnabled || hasGps) {
      const items: NavGroup['items'] = [];
      if (aiEnabled) {
        items.push({ to: '/people', title: 'People', icon: 'people', count: peopleQ.data ? peopleQ.data.length : null });
        items.push({ to: '/places', title: 'Places', icon: 'places', count: placesQ.data ? placesQ.data.length : null });
      }
      if (hasGps) items.push({ to: '/map', title: 'Map', icon: 'map', count: null });
      groups.push({ label: 'People & Places', items });
    }
    groups.push({
      label: 'Albums',
      items: [{ to: '/albums', title: 'Albums', icon: 'albums', count: albumsQ.data ? albumsQ.data.length : null }],
    });
    groups.push({
      label: 'Library',
      items: [
        { to: '/backup', title: 'Backup Health', icon: 'cloud', count: pending || null },
        { to: '/hidden', title: 'Hidden', icon: 'hidden', count: hiddenCount || null },
        { to: '/deleted', title: 'Recently Deleted', icon: 'trash', count: null },
      ],
    });
    return groups;
  }, [visible, aiEnabled, peopleQ.data, placesQ.data, albumsQ.data, hiddenCount]);

  return (
    <>
      {!booted ? <BootLoader fading={bootFading} /> : null}
      <TopBar
        status={statusQ.data}
        online={online}
        pending={pending}
        items={visible.length}
        fetching={libQ.isFetching && !libQ.data}
        onOpenAccount={openAccount}
        onToggleNav={() => setNavOpen((v) => !v)}
      />
      <div className="shell">
        <Sidebar
          groups={navGroups}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          status={statusQ.data}
          online={online}
          serverName={serverName}
          onOpenAccount={openAccount}
        />
        <main className="content" id="content" ref={contentRef}>
          <SearchBox photos={visible} />
          {searchResults !== null ? (
            <SearchResults />
          ) : (
            <Routes>
              <Route path="/" element={<LibraryView />} />
              <Route path="/category/:key" element={<CategoryView />} />
              <Route path="/hidden" element={<HiddenView />} />
              <Route path="/deleted" element={<DeletedView />} />
              <Route path="/people" element={<PeopleView />} />
              <Route path="/places" element={<PlacesView />} />
              <Route path="/person/:id" element={<PersonView />} />
              <Route path="/place/:label" element={<PlaceView />} />
              <Route path="/albums" element={<AlbumsView />} />
              <Route path="/album/:id" element={<AlbumView />} />
              <Route
                path="/map"
                element={
                  <Suspense fallback={<div className="bh-note" style={{ padding: 20 }}>Loading map…</div>}>
                    <MapView />
                  </Suspense>
                }
              />
              <Route path="/backup" element={<BackupHealthView />} />
              <Route path="/welcome" element={<Onboarding />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
      <LightboxWithAlbums serverName={serverName} />
    </>
  );
}

// ------------------------------------------------------------------- search

/**
 * Parse search operators out of the raw query: `type:video`, `person:Name`
 * (or person:"Two Words"), `year:2024`. What remains is the semantic text.
 */
function parseQuery(raw: string): { text: string; filters: SearchFilters } {
  const filters: SearchFilters = {};
  let text = raw;
  text = text.replace(/\btype:(photos?|videos?)\b/gi, (_m, t: string) => {
    filters.type = t.toLowerCase().startsWith('v') ? 'video' : 'photo';
    return ' ';
  });
  text = text.replace(/\byear:(\d{4})\b/gi, (_m, y: string) => {
    filters.year = Number(y);
    return ' ';
  });
  text = text.replace(/\bperson:"([^"]+)"|\bperson:(\S+)/gi, (_m, a: string, b: string) => {
    filters.person = a || b;
    return ' ';
  });
  return { text: text.replace(/\s+/g, ' ').trim(), filters };
}

const RECENTS_KEY = 'nookRecentSearches';
function readRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveRecent(q: string) {
  const list = [q, ...readRecents().filter((x) => x !== q)].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

function SearchBox({ photos }: { photos: PhotoRecord[] }) {
  const { client } = useAuth();
  const { searchQuery, setSearchState } = useView();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const run = async (raw: string) => {
    const trimmed = raw.trim();
    const mySeq = ++seq.current;
    if (!trimmed) {
      setSearchState('', null, false);
      return;
    }
    const { text, filters } = parseQuery(trimmed);
    setSearchState(trimmed, [], true, filters);
    let results: PhotoRecord[] | null = null;
    if (text) {
      try {
        results = (await client.search(text, 150)).photos;
      } catch {
        /* fall through to local filter */
      }
      if (mySeq !== seq.current) return;
      if (!results) {
        const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
        results = photosRef.current.filter((p) => {
          const hay = (p.filename + ' ' + dayLabelOf(p.createdAt)).toLowerCase();
          return terms.every((t) => hay.includes(t));
        });
      }
    } else {
      // Operators only ("type:video year:2024") → filter the whole library.
      results = photosRef.current;
    }
    if (mySeq !== seq.current) return;
    saveRecent(trimmed);
    setRecents(readRecents());
    setSearchState(trimmed, results, false, filters);
  };

  const onChange = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v), 300);
  };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue('');
    setSearchState('', null, false);
  };

  const showRecents = focused && !value.trim() && recents.length > 0;

  return (
    // A real search form (role + name="q") so browser password managers
    // classify this as a search box, not a login field to autofill.
    <form className="toolbar" role="search" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      <div className="searchbox">
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.9" />
          <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <input
          id="searchInput"
          type="search"
          name="q"
          role="searchbox"
          aria-label="Search your photos"
          placeholder="Search your photos, people, places…"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') clear();
          }}
        />
        {value.trim() ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
            ×
          </button>
        ) : null}
        {showRecents ? (
          <div className="search-recents">
            {recents.map((r) => (
              <button
                key={r}
                type="button"
                className="search-recent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setValue(r);
                  run(r);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>{r}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </form>
  );
}

// -------------------------------------------------- lightbox + add-to-album

function LightboxWithAlbums({ serverName }: { serverName: string }) {
  const modals = useModals();
  const toast = useToast();
  const actions = useActions();
  const albumsQ = useAlbumsQ();

  const addToAlbum = async (p: PhotoRecord) => {
    const choice = await modals.albumPicker(albumsQ.data || [], p.id);
    if (!choice) return;
    let albumId = choice.albumId;
    if (choice.createName) {
      const created = await actions.createAlbum(choice.createName);
      if (!created) return;
      albumId = created.id;
    }
    if (!albumId) return;
    const updated = await actions.patchAlbum(albumId, { addPhotoIds: [p.id] }, 'Could not add to album');
    if (updated) toast('Added to “' + updated.name + '”');
  };

  return <Lightbox serverName={serverName} onAddToAlbum={addToAlbum} />;
}
