import { useMemo } from 'react';
import { Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlbum, useLibrary } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';
import { useTheme } from '@/theme';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const album = useAlbum(id);
  const library = useLibrary();
  const t = useTheme();

  const photos = useMemo(() => {
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
      right={
        <Pressable onPress={() => router.push({ pathname: '/album-share/[id]', params: { id } })} hitSlop={8}>
          <MaterialIcons name="ios-share" size={24} color={t.colors.onSurface} />
        </Pressable>
      }
    />
  );
}
