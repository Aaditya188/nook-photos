import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useAlbum, useLibrary } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const album = useAlbum(id);
  const library = useLibrary();

  const photos = useMemo(() => {
    const ids = new Set(album.data?.photoIds ?? []);
    const byId = new Map((library.data ?? []).map((p) => [p.id, p]));
    return (album.data?.photoIds ?? []).map((pid) => byId.get(pid)).filter(Boolean) as NonNullable<
      ReturnType<typeof byId.get>
    >[];
  }, [album.data, library.data]);

  return (
    <CollectionScreen
      title={album.data?.name ?? 'Album'}
      subtitle={album.data ? `${album.data.photoCount} photos` : undefined}
      photos={photos as any}
      loading={album.isLoading || library.isLoading}
      emptyText="This album is empty"
    />
  );
}
