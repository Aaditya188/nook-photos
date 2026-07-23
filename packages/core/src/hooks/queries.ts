/**
 * React Query hooks over the Nook API — shared by mobile and web. Keys are
 * centralized so mutations can invalidate precisely.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNookClient } from './context';
import type { PhotoUpload } from '../api/types';

export const qk = {
  serverInfo: ['serverInfo'] as const,
  account: ['account'] as const,
  status: ['status'] as const,
  library: ['library'] as const,
  deleted: ['deleted'] as const,
  people: ['people'] as const,
  personPhotos: (id: string) => ['people', id, 'photos'] as const,
  places: ['places'] as const,
  placePhotos: (label: string) => ['places', label, 'photos'] as const,
  albums: ['albums'] as const,
  album: (id: string) => ['albums', id] as const,
  users: ['users'] as const,
  search: (q: string) => ['search', q] as const,
};

export function useServerInfo() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.serverInfo, queryFn: () => client.serverInfo() });
}

export function useAccount() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.account, queryFn: () => client.account() });
}

export function useStatus() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.status, queryFn: () => client.status() });
}

export function useLibrary() {
  const client = useNookClient();
  return useQuery({
    queryKey: qk.library,
    queryFn: async () => (await client.library()).photos,
  });
}

export function useDeletedPhotos() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.deleted, queryFn: async () => (await client.deleted()).photos });
}

export function usePeople() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.people, queryFn: async () => (await client.people()).people });
}

export function usePersonPhotos(id: string) {
  const client = useNookClient();
  return useQuery({
    queryKey: qk.personPhotos(id),
    queryFn: async () => (await client.personPhotos(id)).photos,
    enabled: !!id,
  });
}

export function usePlaces() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.places, queryFn: async () => (await client.places()).places });
}

export function usePlacePhotos(label: string) {
  const client = useNookClient();
  return useQuery({
    queryKey: qk.placePhotos(label),
    queryFn: async () => (await client.placePhotos(label)).photos,
    enabled: !!label,
  });
}

export function useAlbums() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.albums, queryFn: async () => (await client.albums()).albums });
}

export function useAlbum(id: string) {
  const client = useNookClient();
  return useQuery({ queryKey: qk.album(id), queryFn: () => client.album(id), enabled: !!id });
}

export function useUsers() {
  const client = useNookClient();
  return useQuery({ queryKey: qk.users, queryFn: async () => (await client.users()).users });
}

export function useSearch(q: string) {
  const client = useNookClient();
  return useQuery({
    queryKey: qk.search(q),
    queryFn: async () => (await client.search(q)).photos,
    enabled: q.trim().length > 0,
  });
}

// ---- mutations ----

export function usePatchPhoto() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; favorite?: boolean; hidden?: boolean }) =>
      client.patchPhoto(v.id, { favorite: v.favorite, hidden: v.hidden }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.library });
    },
  });
}

export function useDeletePhoto() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deletePhoto(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.deleted });
    },
  });
}

export function useCreateAlbum() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.createAlbum(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.albums }),
  });
}

export function useAddPhotosToAlbum() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { albumId: string; photoIds: string[] }) =>
      client.patchAlbum(v.albumId, { addPhotoIds: v.photoIds }),
    onSuccess: (album) => {
      qc.invalidateQueries({ queryKey: qk.albums });
      qc.invalidateQueries({ queryKey: qk.album(album.id) });
    },
  });
}

export function useRemovePhotosFromAlbum() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { albumId: string; photoIds: string[] }) =>
      client.patchAlbum(v.albumId, { removePhotoIds: v.photoIds }),
    onSuccess: (album) => {
      qc.invalidateQueries({ queryKey: qk.albums });
      qc.invalidateQueries({ queryKey: qk.album(album.id) });
    },
  });
}

export function useCreatePhoto() {
  const client = useNookClient();
  return useMutation({ mutationFn: (meta: PhotoUpload) => client.createPhoto(meta) });
}

export function useCreateUser() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; displayName: string; email?: string; role?: string }) =>
      client.createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useDeleteUser() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

export function useUpdateAccount() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName?: string; email?: string; newPassword?: string; currentPassword?: string }) =>
      client.updateAccount(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.account }),
  });
}

export function useRestorePhoto() {
  const client = useNookClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.restorePhoto(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.deleted });
    },
  });
}
