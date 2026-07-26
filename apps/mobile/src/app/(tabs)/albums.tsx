/**
 * Collections — the mobile hub, styled after Apple Photos' Collections tab:
 * a Featured rail, People and Trips rails, the album grid, and Media-Types /
 * Utilities lists. Every section is fed by the shared @nook/core queries and
 * links into the existing detail routes.
 */
import { useMemo } from 'react';
import { View, Pressable, ScrollView, Alert, FlatList } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  useAlbums,
  useLibrary,
  usePeople,
  usePlaces,
  useCreateAlbum,
  useDeletedPhotos,
  detectTrips,
  tripTitle,
  type Album,
  type PhotoRecord,
} from '@nook/core';
import { RemoteThumb, FaceThumb } from '@/components/RemoteImage';
import { Text, Card, Divider, BrandLoader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export default function CollectionsScreen() {
  const t = useTheme();
  const albums = useAlbums();
  const library = useLibrary();
  const people = usePeople();
  const places = usePlaces();
  const deleted = useDeletedPhotos();
  const createAlbum = useCreateAlbum();
  const setViewerList = useViewer((s) => s.setList);

  const loading = albums.isLoading || library.isLoading || deleted.isLoading;

  const live = useMemo(
    () => (library.data ?? []).filter((p) => !p.hidden && p.uploadState === 'complete'),
    [library.data],
  );

  const counts = useMemo(
    () => ({
      videos: live.filter((p) => p.mediaType === 'video').length,
      portraits: live.filter((p) => p.portrait).length,
      screenshots: live.filter((p) => p.screenshot).length,
      panoramas: live.filter((p) => p.panorama).length,
      livePhotos: live.filter((p) => p.live).length,
      favorites: live.filter((p) => p.favorite).length,
      hidden: (library.data ?? []).filter((p) => p.hidden).length,
      deleted: deleted.data?.length ?? 0,
    }),
    [live, library.data, deleted.data],
  );

  // Featured: your favorites, else the most recent shots. Tapping opens the
  // viewer scoped to just this rail.
  const featured = useMemo(() => {
    const favs = live.filter((p) => p.favorite);
    return (favs.length >= 4 ? favs : live).slice(0, 12);
  }, [live]);

  const trips = useMemo(() => detectTrips(library.data ?? []), [library.data]);
  const peopleList = useMemo(() => (people.data ?? []).filter((p) => p.count > 0).slice(0, 15), [people.data]);
  const placesList = useMemo(() => (places.data ?? []).filter((p) => p.count > 0).slice(0, 15), [places.data]);

  function newAlbum() {
    const create = async (name: string) => {
      const a = await createAlbum.mutateAsync(name);
      router.push({ pathname: '/album/[id]', params: { id: a.id } });
    };
    // Alert.prompt is iOS-only; on Android create with a default name (rename in
    // the album) so the button isn't a silent no-op.
    if (typeof Alert.prompt === 'function') {
      Alert.prompt('New Album', 'Name your album', (name?: string) => {
        if (name?.trim()) create(name.trim());
      });
    } else {
      create('New Album');
    }
  }

  function openFeatured(photo: PhotoRecord) {
    setViewerList(featured);
    router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
  }

  const mediaTypes: { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; count: number }[] = [
    { key: 'videos', label: 'Videos', icon: 'videocam', count: counts.videos },
    { key: 'portraits', label: 'Portraits', icon: 'portrait', count: counts.portraits },
    { key: 'screenshots', label: 'Screenshots', icon: 'smartphone', count: counts.screenshots },
    { key: 'panoramas', label: 'Panoramas', icon: 'panorama-horizontal', count: counts.panoramas },
    { key: 'live', label: 'Live Photos', icon: 'motion-photos-on', count: counts.livePhotos },
    { key: 'favorites', label: 'Favorites', icon: 'favorite', count: counts.favorites },
  ];

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        <BrandLoader label="Loading your collections…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView contentContainerStyle={{ paddingVertical: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg }}>
          <Text variant="headline">Collections</Text>
          <Pressable onPress={newAlbum} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialIcons name="add" size={22} color={t.colors.primaryContainer} />
            <Text variant="titleSmall" color={t.colors.primaryContainer}>New</Text>
          </Pressable>
        </View>

        {/* Featured */}
        {featured.length > 0 ? (
          <View style={{ gap: t.spacing.md }}>
            <SectionHead title="Featured Photos" />
            <FlatList
              horizontal
              data={featured}
              keyExtractor={(p) => p.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}
              renderItem={({ item }) => (
                <Pressable onPress={() => openFeatured(item)}>
                  <View style={{ width: 260, height: 190, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
                    <RemoteThumb photoId={item.id} displaySize={280} style={{ width: '100%', height: '100%' }} />
                  </View>
                </Pressable>
              )}
            />
          </View>
        ) : null}

        {/* People & Places — one section, two groups */}
        {peopleList.length > 0 || placesList.length > 0 ? (
          <View style={{ gap: t.spacing.md }}>
            <SectionHead title="People & Places" onPress={() => router.push('/people')} />

            {peopleList.length > 0 ? (
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="label" color={t.colors.onSurfaceVariant} style={{ paddingHorizontal: t.spacing.lg }}>PEOPLE</Text>
                <FlatList
                  horizontal
                  data={peopleList}
                  keyExtractor={(p) => 'person:' + p.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => router.push({ pathname: '/people/[id]', params: { id: item.id, name: item.name ?? 'Person' } })}
                      style={{ alignItems: 'center', width: 84 }}
                    >
                      <FaceThumb photoId={item.coverPhotoId} face={item.coverFace} size={80} bg={t.colors.surfaceContainerHigh} />
                      <Text variant="caption" numberOfLines={1} style={{ marginTop: 5, maxWidth: 84, textAlign: 'center' }}>
                        {item.name ?? 'Add Name'}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            ) : null}

            {placesList.length > 0 ? (
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="label" color={t.colors.onSurfaceVariant} style={{ paddingHorizontal: t.spacing.lg }}>PLACES</Text>
                <FlatList
                  horizontal
                  data={placesList}
                  keyExtractor={(p) => 'place:' + p.label}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => router.push({ pathname: '/place/[label]', params: { label: item.label } })}
                      style={{ width: 116 }}
                    >
                      <View style={{ width: 116, height: 116, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
                        <RemoteThumb photoId={item.coverPhotoId} displaySize={130} style={{ width: '100%', height: '100%' }} />
                      </View>
                      <Text variant="caption" numberOfLines={1} style={{ marginTop: 5, maxWidth: 116 }}>
                        {item.label.split(',')[0]}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Trips */}
        {trips.length > 0 ? (
          <View style={{ gap: t.spacing.md }}>
            <SectionHead title="Trips" onPress={() => router.push('/trips')} />
            <FlatList
              horizontal
              data={trips.slice(0, 12)}
              keyExtractor={(tr) => tr.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}
              renderItem={({ item }) => (
                <Pressable onPress={() => router.push({ pathname: '/trip/[id]', params: { id: item.id } })}>
                  <View style={{ width: 220, height: 150, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
                    <RemoteThumb photoId={item.cover.id} displaySize={240} style={{ width: '100%', height: '100%' }} />
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.35)' }}>
                      <Text variant="titleSmall" color="#fff" numberOfLines={1}>{tripTitle(item)}</Text>
                      <Text variant="caption" color="rgba(255,255,255,0.85)">{item.photos.length} items</Text>
                    </View>
                  </View>
                </Pressable>
              )}
            />
          </View>
        ) : null}

        {/* My Albums */}
        <View style={{ gap: t.spacing.md, paddingHorizontal: t.spacing.lg }}>
          <SectionHead title="Albums" flush />
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
        <View style={{ gap: t.spacing.md, paddingHorizontal: t.spacing.lg }}>
          <SectionHead title="Media Types" flush />
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
        <View style={{ gap: t.spacing.md, paddingHorizontal: t.spacing.lg }}>
          <SectionHead title="Utilities" flush />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <UtilRow icon="content-copy" label="Duplicates" onPress={() => router.push('/duplicates')} />
            <Divider />
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

function SectionHead({ title, onPress, flush }: { title: string; onPress?: () => void; flush?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: flush ? 0 : t.spacing.lg }}
    >
      <Text variant="title">{title}</Text>
      {onPress ? <MaterialIcons name="chevron-right" size={22} color={t.colors.onSurfaceVariant} /> : null}
    </Pressable>
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
