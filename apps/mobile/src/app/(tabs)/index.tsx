import { useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useLibrary, useDeletePhoto, type PhotoRecord } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Text, BrandLoader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LibraryScreen() {
  const t = useTheme();
  const library = useLibrary();
  const deletePhoto = useDeletePhoto();
  const setViewerList = useViewer((s) => s.setList);
  const gridColumns = useSettings((s) => s.prefs.gridColumns);

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

  // Drag-select applies one explicit action per cell so a pass doesn't flip a
  // cell back off.
  function setSelectState(id: string, on: boolean) {
    setSelected((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const run = async () => {
      setSelectMode(false);
      setSelected(new Set());
      for (const id of ids) await deletePhoto.mutateAsync(id).catch(() => {});
    };
    if (useSettings.getState().prefs.confirmDelete) {
      Alert.alert(
        `Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'}?`,
        'They move to Recently Deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: run },
        ],
      );
    } else {
      run();
    }
  }

  const header = () => (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="headline">Library</Text>
        {selectMode ? (
          <Pressable onPress={() => { setSelectMode(false); setSelected(new Set()); }}>
            <Text variant="titleSmall" color={t.colors.primaryContainer}>Done</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => setSelectMode(true)} hitSlop={8}>
            <Text variant="titleSmall" color={t.colors.primaryContainer}>Select</Text>
          </Pressable>
        )}
      </View>
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
        columns={gridColumns}
        photos={photos}
        renderHeader={header}
        onPressPhoto={openPhoto}
        selectionMode={selectMode}
        selected={selected}
        onToggleSelect={toggleSelect}
        onSetSelect={setSelectState}
        onEnterSelect={() => setSelectMode(true)}
      />

      {/* Floating Search button — bottom-right, just above the tab bar. */}
      {!selectMode ? (
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityLabel="Search"
          style={{
            position: 'absolute',
            right: 18,
            bottom: 22,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: t.colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 5,
          }}>
          <MaterialIcons name="search" size={28} color={t.colors.onPrimary} />
        </Pressable>
      ) : null}

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
