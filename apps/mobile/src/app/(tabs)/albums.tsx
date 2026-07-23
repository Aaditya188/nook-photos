import { useMemo, useState } from 'react';
import { View, Pressable, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlbums, useLibrary, useCreateAlbum, useDeletedPhotos, type Album } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, Card, Divider } from '@/components/ui';
import { useTheme } from '@/theme';

export default function AlbumsScreen() {
  const t = useTheme();
  const albums = useAlbums();
  const library = useLibrary();
  const deleted = useDeletedPhotos();
  const createAlbum = useCreateAlbum();

  const counts = useMemo(() => {
    const live = (library.data ?? []).filter((p) => !p.hidden && p.uploadState === 'complete');
    return {
      videos: live.filter((p) => p.mediaType === 'video').length,
      portraits: live.filter((p) => p.portrait).length,
      screenshots: live.filter((p) => p.screenshot).length,
      panoramas: live.filter((p) => p.panorama).length,
      livePhotos: live.filter((p) => p.live).length,
      hidden: (library.data ?? []).filter((p) => p.hidden).length,
      deleted: deleted.data?.length ?? 0,
    };
  }, [library.data, deleted.data]);

  function newAlbum() {
    Alert.prompt?.('New Album', 'Name your album', async (name?: string) => {
      if (name?.trim()) {
        const a = await createAlbum.mutateAsync(name.trim());
        router.push({ pathname: '/album/[id]', params: { id: a.id } });
      }
    });
  }

  const mediaTypes: { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; count: number }[] = [
    { key: 'videos', label: 'Videos', icon: 'videocam', count: counts.videos },
    { key: 'portraits', label: 'Portraits', icon: 'portrait', count: counts.portraits },
    { key: 'screenshots', label: 'Screenshots', icon: 'smartphone', count: counts.screenshots },
    { key: 'panoramas', label: 'Panoramas', icon: 'panorama-horizontal', count: counts.panoramas },
    { key: 'live', label: 'Live Photos', icon: 'motion-photos-on', count: counts.livePhotos },
    { key: 'favorites', label: 'Favorites', icon: 'favorite', count: (library.data ?? []).filter((p) => p.favorite).length },
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="headline">Albums</Text>
          <Pressable onPress={newAlbum} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="add" size={22} color={t.colors.primaryContainer} />
            <Text variant="titleSmall" color={t.colors.primaryContainer}>New</Text>
          </Pressable>
        </View>

        {/* My Albums */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="title">My Albums</Text>
          {(albums.data ?? []).length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: t.spacing.xl, gap: 6 }}>
              <MaterialIcons name="photo-album" size={36} color={t.colors.outline} />
              <Text variant="caption" color={t.colors.onSurfaceVariant}>No albums yet — tap “New”.</Text>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
              {(albums.data ?? []).map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </View>
          )}
        </View>

        {/* Media Types */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="title">Media Types</Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {mediaTypes.map((m, i) => (
              <View key={m.key}>
                <Pressable
                  onPress={() => router.push({ pathname: '/category/[type]', params: { type: m.key } })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                  <MaterialIcons name={m.icon} size={22} color={t.colors.primaryContainer} />
                  <Text variant="body" style={{ flex: 1 }}>{m.label}</Text>
                  <Text variant="body" color={t.colors.onSurfaceVariant}>{m.count}</Text>
                  <MaterialIcons name="chevron-right" size={22} color={t.colors.outline} />
                </Pressable>
                {i < mediaTypes.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
        </View>

        {/* Utilities */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="title">Utilities</Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <UtilRow icon="visibility-off" label="Hidden" count={counts.hidden} locked onPress={() => router.push('/hidden')} />
            <Divider />
            <UtilRow icon="lock-outline" label="Locked" locked onPress={() => router.push('/locked')} />
            <Divider />
            <UtilRow icon="delete-outline" label="Recently Deleted" count={counts.deleted} onPress={() => router.push('/deleted')} />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const t = useTheme();
  const size = 160;
  return (
    <Pressable onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })} style={{ width: '47%' }}>
      <View style={{ aspectRatio: 1, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
        {album.coverPhotoId ? (
          <RemoteThumb photoId={album.coverPhotoId} displaySize={size} style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name="photo-album" size={32} color={t.colors.outline} />
          </View>
        )}
      </View>
      <Text variant="titleSmall" numberOfLines={1} style={{ marginTop: 6 }}>{album.name}</Text>
      <Text variant="caption" color={t.colors.onSurfaceVariant}>{album.photoCount}</Text>
    </Pressable>
  );
}

function UtilRow({
  icon,
  label,
  count,
  locked,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  count?: number;
  locked?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
      <MaterialIcons name={icon} size={22} color={t.colors.onSurfaceVariant} />
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      {count != null ? <Text variant="body" color={t.colors.onSurfaceVariant}>{count}</Text> : null}
      {locked ? <MaterialIcons name="lock" size={16} color={t.colors.outline} /> : null}
      <MaterialIcons name="chevron-right" size={22} color={t.colors.outline} />
    </Pressable>
  );
}
