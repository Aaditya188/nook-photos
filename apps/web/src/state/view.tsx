/**
 * Per-view UI state shared across the shell: multi-select, search results, the
 * lightbox, and the "current list" (what the lightbox pages over — the photos
 * rendered by the active view).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PhotoRecord } from '@nook/core';

interface ViewState {
  // selection
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  enterSelect: () => void;
  exitSelect: () => void;
  toggleSelect: (id: string) => void;
  setSelectedMany: (ids: string[], selected: boolean) => void;
  // search
  searchQuery: string;
  searchResults: PhotoRecord[] | null;
  searching: boolean;
  setSearchState: (q: string, results: PhotoRecord[] | null, searching: boolean) => void;
  // current list + lightbox
  currentList: PhotoRecord[];
  setCurrentList: (list: PhotoRecord[]) => void;
  lightboxId: string | null;
  openLightbox: (id: string) => void;
  closeLightbox: () => void;
  stepLightbox: (delta: number) => void;
  /** Advance off a photo that just left the list (or close if list empty). */
  stepOffPhoto: (id: string) => void;
}

const ViewContext = createContext<ViewState | null>(null);

export function ViewProvider({ children }: { children: ReactNode }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PhotoRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [currentList, setCurrentListState] = useState<PhotoRecord[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const listRef = useRef(currentList);
  listRef.current = currentList;

  const enterSelect = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(true);
  }, []);
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setSelectedMany = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const setSearchState = useCallback(
    (q: string, results: PhotoRecord[] | null, isSearching: boolean) => {
      setSearchQuery(q);
      setSearchResults(results);
      setSearching(isSearching);
    },
    [],
  );

  const setCurrentList = useCallback((list: PhotoRecord[]) => {
    setCurrentListState(list);
  }, []);

  const openLightbox = useCallback((id: string) => setLightboxId(id), []);
  const closeLightbox = useCallback(() => setLightboxId(null), []);

  const stepLightbox = useCallback((delta: number) => {
    setLightboxId((cur) => {
      const list = listRef.current;
      if (cur === null || list.length === 0) return cur;
      const i = list.findIndex((p) => p.id === cur);
      const next = i < 0 ? 0 : (i + delta + list.length) % list.length;
      return list[next].id;
    });
  }, []);

  const stepOffPhoto = useCallback((id: string) => {
    setLightboxId((cur) => {
      if (cur !== id) return cur;
      const list = listRef.current;
      const i = list.findIndex((p) => p.id === id);
      const remaining = list.filter((p) => p.id !== id);
      if (remaining.length === 0) return null;
      const nextIdx = Math.min(i < 0 ? 0 : i, remaining.length - 1);
      return remaining[nextIdx].id;
    });
  }, []);

  // Lock page scroll while the lightbox is open.
  useEffect(() => {
    document.body.classList.toggle('no-scroll', lightboxId !== null);
    return () => document.body.classList.remove('no-scroll');
  }, [lightboxId]);

  const value = useMemo<ViewState>(
    () => ({
      selectMode,
      selectedIds,
      enterSelect,
      exitSelect,
      toggleSelect,
      setSelectedMany,
      searchQuery,
      searchResults,
      searching,
      setSearchState,
      currentList,
      setCurrentList,
      lightboxId,
      openLightbox,
      closeLightbox,
      stepLightbox,
      stepOffPhoto,
    }),
    [
      selectMode,
      selectedIds,
      enterSelect,
      exitSelect,
      toggleSelect,
      setSelectedMany,
      searchQuery,
      searchResults,
      searching,
      setSearchState,
      currentList,
      setCurrentList,
      lightboxId,
      openLightbox,
      closeLightbox,
      stepLightbox,
      stepOffPhoto,
    ],
  );

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView outside ViewProvider');
  return ctx;
}

/** Views call this to publish the list their grid is showing. */
export function useRegisterList(list: PhotoRecord[]) {
  const { setCurrentList } = useView();
  useEffect(() => {
    setCurrentList(list);
  }, [list, setCurrentList]);
}
