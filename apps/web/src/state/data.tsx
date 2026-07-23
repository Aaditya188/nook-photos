/**
 * Server data via TanStack Query. The library + status poll every 5s (matching
 * the vanilla dashboard); structural sharing means unchanged payloads cause no
 * re-render. Mutations update the library cache optimistically-after-response
 * and invalidate the derived collections, mirroring the vanilla cache rules.
 */
import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  NookApiError,
  type Album,
  type Person,
  type PhotoRecord,
  type Place,
  type ServerInfo,
  type StatusRecord,
  type User,
} from '@nook/core';
import { useAuth } from './auth';
import { useToast } from './ui';

const POLL_MS = 5000;

export const qk = {
  status: ['status'] as const,
  library: ['library'] as const,
  deleted: ['deleted'] as const,
  albums: ['albums'] as const,
  people: ['people'] as const,
  places: ['places'] as const,
  server: ['server'] as const,
  personPhotos: (id: string) => ['personPhotos', id] as const,
  placePhotos: (label: string) => ['placePhotos', label] as const,
};

/** 401 anywhere → drop the session (login screen). */
function use401Guard() {
  const { signOutLocal } = useAuth();
  return useCallback(
    (err: unknown) => {
      if (err instanceof NookApiError && err.status === 401) {
        signOutLocal();
        return true;
      }
      return false;
    },
    [signOutLocal],
  );
}

export function useServerInfoQ() {
  const { client, token } = useAuth();
  return useQuery<ServerInfo>({
    queryKey: qk.server,
    queryFn: () => client.serverInfo(),
    enabled: !!token,
    staleTime: 60_000,
  });
}

export function useStatusQ() {
  const { client, token } = useAuth();
  const guard = use401Guard();
  return useQuery<StatusRecord>({
    queryKey: qk.status,
    queryFn: async () => {
      try {
        return await client.status();
      } catch (e) {
        guard(e);
        throw e;
      }
    },
    enabled: !!token,
    refetchInterval: POLL_MS,
    retry: false,
  });
}

export function useLibraryQ() {
  const { client, token } = useAuth();
  const guard = use401Guard();
  return useQuery<PhotoRecord[]>({
    queryKey: qk.library,
    queryFn: async () => {
      try {
        return (await client.library()).photos;
      } catch (e) {
        guard(e);
        throw e;
      }
    },
    enabled: !!token,
    refetchInterval: POLL_MS,
    retry: false,
  });
}

export function useDeletedQ(enabled: boolean) {
  const { client, token } = useAuth();
  return useQuery<PhotoRecord[]>({
    queryKey: qk.deleted,
    queryFn: async () => (await client.deleted()).photos,
    enabled: !!token && enabled,
    refetchInterval: POLL_MS,
  });
}

export function useAlbumsQ() {
  const { client, token } = useAuth();
  return useQuery<Album[]>({
    queryKey: qk.albums,
    queryFn: async () => (await client.albums()).albums,
    enabled: !!token,
    staleTime: 30_000,
  });
}

export function usePeopleQ(enabled = true) {
  const { client, token } = useAuth();
  return useQuery<Person[]>({
    queryKey: qk.people,
    queryFn: async () => (await client.people()).people,
    enabled: !!token && enabled,
    staleTime: 60_000,
  });
}

export function usePlacesQ(enabled = true) {
  const { client, token } = useAuth();
  return useQuery<Place[]>({
    queryKey: qk.places,
    queryFn: async () => (await client.places()).places,
    enabled: !!token && enabled,
    staleTime: 60_000,
  });
}

export function usePersonPhotosQ(id: string | undefined) {
  const { client, token } = useAuth();
  return useQuery<PhotoRecord[]>({
    queryKey: qk.personPhotos(id || ''),
    queryFn: async () => (await client.personPhotos(id!)).photos,
    enabled: !!token && !!id,
    refetchInterval: POLL_MS * 2,
  });
}

export function usePlacePhotosQ(label: string | undefined) {
  const { client, token } = useAuth();
  return useQuery<PhotoRecord[]>({
    queryKey: qk.placePhotos(label || ''),
    queryFn: async () => (await client.placePhotos(label!)).photos,
    enabled: !!token && !!label,
    refetchInterval: POLL_MS * 2,
  });
}

// ------------------------------------------------------------- cache helpers

function replaceInList(list: PhotoRecord[] | undefined, updated: PhotoRecord) {
  if (!list) return list;
  const i = list.findIndex((p) => p.id === updated.id);
  if (i < 0) return list;
  const next = list.slice();
  next[i] = updated;
  return next;
}

function removeFromList(list: PhotoRecord[] | undefined, id: string) {
  if (!list) return list;
  return list.filter((p) => p.id !== id);
}

/** Apply a photo update across the library + all fetched photo-list caches. */
export function applyPhotoUpdate(qc: QueryClient, updated: PhotoRecord) {
  qc.setQueryData<PhotoRecord[]>(qk.library, (l) => replaceInList(l, updated));
  qc.setQueriesData<PhotoRecord[]>({ queryKey: ['personPhotos'] }, (l) => replaceInList(l, updated));
  qc.setQueriesData<PhotoRecord[]>({ queryKey: ['placePhotos'] }, (l) => replaceInList(l, updated));
  qc.setQueryData<PhotoRecord[]>(qk.deleted, (l) => replaceInList(l, updated));
}

export function removePhotoEverywhere(qc: QueryClient, id: string) {
  qc.setQueryData<PhotoRecord[]>(qk.library, (l) => removeFromList(l, id));
  qc.setQueriesData<PhotoRecord[]>({ queryKey: ['personPhotos'] }, (l) => removeFromList(l, id));
  qc.setQueriesData<PhotoRecord[]>({ queryKey: ['placePhotos'] }, (l) => removeFromList(l, id));
  qc.setQueryData<PhotoRecord[]>(qk.deleted, (l) => removeFromList(l, id));
}

function replaceAlbumIn(qc: QueryClient, updated: Album) {
  qc.setQueryData<Album[]>(qk.albums, (list) => {
    if (!list) return list;
    const i = list.findIndex((a) => a.id === updated.id);
    if (i < 0) return list;
    const next = list.slice();
    next[i] = updated;
    return next;
  });
}

// ------------------------------------------------------------------ actions

/** All photo/album mutations with the vanilla dashboard's cache semantics. */
export function useActions() {
  const { client } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const guard = use401Guard();

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, errMsg: string): Promise<T | null> => {
      try {
        return await fn();
      } catch (e) {
        if (!guard(e)) toast(errMsg);
        return null;
      }
    },
    [guard, toast],
  );

  const toggleFavorite = useCallback(
    async (p: PhotoRecord) => {
      const updated = await run(
        () => client.patchPhoto(p.id, { favorite: !p.favorite }),
        'Could not update favorite',
      );
      if (updated) applyPhotoUpdate(qc, updated);
      return updated;
    },
    [client, qc, run],
  );

  const toggleHidden = useCallback(
    async (p: PhotoRecord) => {
      const willHide = !p.hidden;
      const updated = await run(
        () => client.patchPhoto(p.id, { hidden: willHide }),
        'Could not update photo',
      );
      if (updated) {
        applyPhotoUpdate(qc, updated);
        toast(willHide ? 'Photo hidden' : 'Photo unhidden');
      }
      return updated;
    },
    [client, qc, run, toast],
  );

  const deletePhoto = useCallback(
    async (p: PhotoRecord) => {
      const res = await run(() => client.deletePhoto(p.id), 'Could not delete photo');
      if (res !== null) {
        removePhotoEverywhere(qc, p.id);
        qc.invalidateQueries({ queryKey: qk.albums });
        qc.invalidateQueries({ queryKey: qk.people });
        qc.invalidateQueries({ queryKey: qk.places });
        qc.invalidateQueries({ queryKey: qk.deleted });
        toast('Moved to Recently Deleted');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const restorePhoto = useCallback(
    async (p: PhotoRecord) => {
      const res = await run(() => client.restorePhoto(p.id), 'Could not restore photo');
      if (res !== null) {
        qc.setQueryData<PhotoRecord[]>(qk.deleted, (l) => removeFromList(l, p.id));
        qc.invalidateQueries({ queryKey: qk.library });
        qc.invalidateQueries({ queryKey: qk.people });
        qc.invalidateQueries({ queryKey: qk.places });
        toast('Photo restored');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const permanentDelete = useCallback(
    async (p: PhotoRecord) => {
      const res = await run(() => client.permanentDeletePhoto(p.id), 'Could not delete photo');
      if (res !== null) {
        qc.setQueryData<PhotoRecord[]>(qk.deleted, (l) => removeFromList(l, p.id));
        toast('Photo deleted');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const emptyDeleted = useCallback(async () => {
    const res = await run(() => client.emptyDeleted(), 'Could not empty');
    if (res !== null) {
      qc.setQueryData<PhotoRecord[]>(qk.deleted, []);
      toast('Recently Deleted emptied');
      return true;
    }
    return false;
  }, [client, qc, run, toast]);

  const createAlbum = useCallback(
    async (name: string) => {
      const album = await run(() => client.createAlbum(name), 'Could not create album');
      if (album) {
        qc.setQueryData<Album[]>(qk.albums, (l) => [album, ...(l || [])]);
      }
      return album;
    },
    [client, qc, run],
  );

  const patchAlbum = useCallback(
    async (
      id: string,
      patch: { name?: string; addPhotoIds?: string[]; removePhotoIds?: string[]; coverPhotoId?: string },
      errMsg = 'Could not update album',
    ) => {
      const updated = await run(() => client.patchAlbum(id, patch), errMsg);
      if (updated) replaceAlbumIn(qc, updated);
      return updated;
    },
    [client, qc, run],
  );

  const deleteAlbum = useCallback(
    async (id: string) => {
      const res = await run(() => client.deleteAlbum(id), 'Could not delete album');
      if (res !== null) {
        qc.setQueryData<Album[]>(qk.albums, (l) => (l || []).filter((a) => a.id !== id));
        return true;
      }
      return false;
    },
    [client, qc, run],
  );

  const renamePerson = useCallback(
    async (id: string, name: string) => {
      const res = await run(() => client.renamePerson(id, name), 'Could not rename');
      if (res !== null) {
        qc.setQueryData<Person[]>(qk.people, (l) =>
          l ? l.map((x) => (x.id === id ? { ...x, name: name || null } : x)) : l,
        );
        toast(name ? 'Renamed' : 'Name removed');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const hidePerson = useCallback(
    async (id: string) => {
      const res = await run(() => client.setPersonHidden(id, true), 'Could not hide person');
      if (res !== null) {
        qc.setQueryData<Person[]>(qk.people, (l) => (l ? l.filter((x) => x.id !== id) : l));
        toast('Person hidden');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const mergePeople = useCallback(
    async (fromId: string, intoId: string) => {
      const res = await run(() => client.mergePeople(fromId, intoId), 'Could not merge');
      if (res !== null) {
        qc.invalidateQueries({ queryKey: qk.people });
        qc.invalidateQueries({ queryKey: ['personPhotos'] });
        toast('People merged');
        return true;
      }
      return false;
    },
    [client, qc, run, toast],
  );

  const updateAccount = useCallback(
    (input: Parameters<typeof client.updateAccount>[0]) => client.updateAccount(input),
    [client],
  );

  return {
    toggleFavorite,
    toggleHidden,
    deletePhoto,
    restorePhoto,
    permanentDelete,
    emptyDeleted,
    createAlbum,
    patchAlbum,
    deleteAlbum,
    renamePerson,
    hidePerson,
    mergePeople,
    updateAccount,
  };
}

export type Actions = ReturnType<typeof useActions>;
export type { User };
