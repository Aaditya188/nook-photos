/**
 * Sharing hub — pick an album to manage who can see it (people grants) and its
 * guest link. User management moved to Profile › Admin › Users.
 */
import { View, Pressable, FlatList } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlbums } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, BrandLoader } from '@/components/ui';
import { useTheme } from '@/theme';

export default function SharingScreen() {
  const t = useTheme();
  const albums = useAlbums();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: t.spacing.lg, gap: 4 }}>
        <Text variant="headline">Sharing</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant}>Choose an album to share with people or a guest link.</Text>
      </View>

      {albums.isLoading ? (
        <BrandLoader label="Loading albums…" />
      ) : (albums.data ?? []).length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md, padding: t.spacing.xl }}>
          <MaterialIcons name="folder-shared" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            No albums yet. Create an album (from a photo's Add-to-album) and it will show up here to share.
          </Text>
        </View>
      ) : (
        <FlatList
          data={albums.data ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: t.spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/album-share/[id]', params: { id: item.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.sm, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceContainer }}>
              {item.coverPhotoId ? (
                <RemoteThumb photoId={item.coverPhotoId} displaySize={56} style={{ width: 56, height: 56, borderRadius: t.radius.md }} />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="photo-album" size={24} color={t.colors.onSurfaceVariant} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text variant="body">{item.name}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>{item.photoCount} photos</Text>
              </View>
              <MaterialIcons name="ios-share" size={22} color={t.colors.primaryContainer} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
