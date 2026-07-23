import { useMemo, useState } from 'react';
import { Alert, Pressable, Share } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlbum, useLibrary, useNookClient } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const album = useAlbum(id);
  const library = useLibrary();
  const client = useNookClient();
  const serverUrl = useAuth((s) => s.serverUrl);
  const t = useTheme();
  const [sharing, setSharing] = useState(false);

  const photos = useMemo(() => {
    const byId = new Map((library.data ?? []).map((p) => [p.id, p]));
    return (album.data?.photoIds ?? []).map((pid) => byId.get(pid)).filter(Boolean) as NonNullable<
      ReturnType<typeof byId.get>
    >[];
  }, [album.data, library.data]);

  // Share link → native share sheet. Reuses an existing link, else creates a
  // 30-day one with downloads enabled (manage/revoke from the web app).
  const shareAlbum = async () => {
    if (sharing || !id) return;
    setSharing(true);
    try {
      let share = await client.albumShare(id);
      if (!share.shared) {
        share = await client.createAlbumShare(id, { expiresDays: 30, allowDownload: true });
      }
      const base = (serverUrl || client.baseUrl).replace(/\/+$/, '');
      const url = base + (share.url ?? '');
      await Share.share({ message: `${album.data?.name ?? 'Album'} — ${url}`, url });
    } catch {
      Alert.alert('Could not share', 'Sharing links need the Nook gateway. Try again in a moment.');
    }
    setSharing(false);
  };

  return (
    <CollectionScreen
      title={album.data?.name ?? 'Album'}
      subtitle={album.data ? `${album.data.photoCount} photos` : undefined}
      photos={photos as any}
      loading={album.isLoading || library.isLoading}
      emptyText="This album is empty"
      right={
        <Pressable onPress={shareAlbum} hitSlop={8} disabled={sharing}>
          <MaterialIcons
            name="ios-share"
            size={24}
            color={sharing ? t.colors.onSurfaceVariant : t.colors.onSurface}
          />
        </Pressable>
      }
    />
  );
}
