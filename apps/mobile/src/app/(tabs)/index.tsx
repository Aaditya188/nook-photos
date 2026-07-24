import { useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useLibrary, useDeletePhoto, type PhotoRecord } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { PeopleRail } from '@/components/PeopleRail';
import { MemoriesRail } from '@/components/MemoriesRail';
import { Text, BrandLoader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LibraryScreen() {
  const t = useTheme();
  const library = useLibrary();
  const deletePhoto = useDeletePhoto();
  const setViewerList = useViewer((s) => s.setList);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const photos = useMemo(
    () => (library.data ?? []).filter((p) => !p.hidden && p.uploadState === 'complete'),
    [library.data],
  );

  function openPhoto(photo: PhotoRecord) {
    setViewerList(photos);
    router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selected];
    setSelectMode(false);
    setSelected(new Set());
    for (const id of ids) await deletePhoto.mutateAsync(id).catch(() => {});
  }

  const header = () => (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, gap: t.spacing.lg, paddingBottom: t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="headline">Nook Photos</Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
          {selectMode ? (
            <Pressable onPress={() => { setSelectMode(false); setSelected(new Set()); }}>
              <Text variant="titleSmall" color={t.colors.primaryContainer}>Done</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={() => router.push('/search')} hitSlop={8}>
                <MaterialIcons name="search" size={26} color={t.colors.onSurface} />
              </Pressable>
              <Pressable onPress={() => setSelectMode(true)} hitSlop={8}>
                <Text variant="titleSmall" color={t.colors.primaryContainer}>Select</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {!selectMode ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <QuickLink icon="luggage" label="Trips" onPress={() => router.push('/trips')} />
          <QuickLink icon="map" label="Map" onPress={() => router.push('/map')} />
          <QuickLink icon="people" label="People" onPress={() => router.push('/people')} />
        </View>
      ) : null}
      {!selectMode ? <MemoriesRail /> : null}
      {!selectMode ? <PeopleRail /> : null}
    </View>
  );

  if (library.isLoading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        <BrandLoader label="Loading your library…" />
      </SafeAreaView>
    );
  }

  if (library.isError) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text variant="body" color={t.colors.error} style={{ textAlign: 'center' }}>
          {(library.error as Error)?.message ?? 'Could not load your library'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <PhotoGrid
        grouped
        photos={photos}
        renderHeader={header}
        onPressPhoto={openPhoto}
        selectionMode={selectMode}
        selected={selected}
        onToggleSelect={toggleSelect}
      />
      {selectMode && selected.size > 0 ? (
        <View
          style={{
            position: 'absolute',
            bottom: 24,
            left: 16,
            right: 16,
            backgroundColor: t.colors.surfaceContainerHighest,
            borderRadius: t.radius.lg,
            padding: t.spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <Text variant="titleSmall">{selected.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: t.spacing.lg, alignItems: 'center' }}>
            <Pressable
              onPress={() => router.push({ pathname: '/add-to-album', params: { ids: [...selected].join(',') } })}
              style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <MaterialIcons name="add-to-photos" size={22} color={t.colors.primaryContainer} />
              <Text variant="titleSmall" color={t.colors.primaryContainer}>Add</Text>
            </Pressable>
            <Pressable onPress={deleteSelected} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <MaterialIcons name="delete-outline" size={22} color={t.colors.error} />
              <Text variant="titleSmall" color={t.colors.error}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** A compact pill shortcut in the Library header (Trips, People & Places…). */
function QuickLink({ icon, label, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: t.radius.pill,
        backgroundColor: t.colors.surfaceContainerHigh,
      }}>
      <MaterialIcons name={icon} size={17} color={t.colors.primaryContainer} />
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}
