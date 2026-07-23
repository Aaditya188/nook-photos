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
import { useSearchParams } from 'react-router-dom';
import type { PhotoRecord } from '@nook/core';

export interface SearchFilters {
  type?: 'photo' | 'video';
  person?: string; // person NAME from a person: operator (resolved to id downstream)
  year?: number;
}

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
  searchFilters: SearchFilters;
  setSearchState: (
    q: string,
    results: PhotoRecord[] | null,
    searching: boolean,
    filters?: SearchFilters,
  ) => void;
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
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({});
  const [currentList, setCurrentListState] = useState<PhotoRecord[]>([]);

  // The lightbox lives in the URL (?photo=<id>) — the single source of truth.
  // Reload, Back/Forward, and shared links all restore the same photo for
  // free, with no state↔URL sync races. Opening pushes a history entry (so
  // Back closes the viewer); stepping and closing replace it.
  const [searchParams, setSearchParams] = useSearchParams();
  const lightboxId = searchParams.get('photo');

  const listRef = useRef(currentList);
  listRef.current = currentList;
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const lbRef = useRef(lightboxId);
  lbRef.current = lightboxId;

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
    (q: string, results: PhotoRecord[] | null, isSearching: boolean, filters?: SearchFilters) => {
      setSearchQuery(q);
      setSearchResults(results);
      setSearching(isSearching);
      setSearchFilters(filters ?? {});
    },
    [],
  );

  const setCurrentList = useCallback((list: PhotoRecord[]) => {
    setCurrentListState(list);
  }, []);

  const writePhotoParam = useCallback(
    (id: string | null, replace: boolean) => {
      const next = new URLSearchParams(paramsRef.current);
      if (id) next.set('photo', id);
      else next.delete('photo');
      setSearchParams(next, { replace });
    },
    [setSearchParams],
  );

  const openLightbox = useCallback(
    (id: string) => writePhotoParam(id, lbRef.current !== null),
    [writePhotoParam],
  );
  const closeLightbox = useCallback(() => {
    if (lbRef.current !== null) writePhotoParam(null, true);
  }, [writePhotoParam]);

  const stepLightbox = useCallback(
    (delta: number) => {
      const cur = lbRef.current;
      const list = listRef.current;
      if (cur === null || list.length === 0) return;
      const i = list.findIndex((p) => p.id === cur);
      const next = i < 0 ? 0 : (i + delta + list.length) % list.length;
      writePhotoParam(list[next].id, true);
    },
    [writePhotoParam],
  );

  const stepOffPhoto = useCallback(
    (id: string) => {
      if (lbRef.current !== id) return;
      const list = listRef.current;
      const i = list.findIndex((p) => p.id === id);
      const remaining = list.filter((p) => p.id !== id);
      if (remaining.length === 0) {
        writePhotoParam(null, true);
        return;
      }
      const nextIdx = Math.min(i < 0 ? 0 : i, remaining.length - 1);
      writePhotoParam(remaining[nextIdx].id, true);
    },
    [writePhotoParam],
  );

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
      searchFilters,
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
      searchFilters,
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
