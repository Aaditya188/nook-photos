import { View, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useDeletedPhotos, useNookClient, qk } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export default function DeletedScreen() {
  const t = useTheme();
  const client = useNookClient();
  const qc = useQueryClient();
  const deleted = useDeletedPhotos();
  const setViewerList = useViewer((s) => s.setList);
  const photos = deleted.data ?? [];

  function empty() {
    Alert.alert('Empty Recently Deleted?', 'This permanently deletes these photos. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          await client.emptyDeleted();
          qc.invalidateQueries({ queryKey: qk.deleted });
        },
      },
    ]);
  }

  const header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.md }}>
      <Pressable onPress={() => router.back()} hitSlop={8}>
        <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
      </Pressable>
      <Text variant="title" style={{ flex: 1 }}>Recently Deleted</Text>
      {photos.length > 0 ? (
        <Pressable onPress={empty}>
          <Text variant="titleSmall" color={t.colors.error}>Empty</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (deleted.isLoading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        {header()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.colors.primaryContainer} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      {photos.length === 0 ? (
        <>
          {header()}
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <MaterialIcons name="delete-outline" size={44} color={t.colors.outline} />
            <Text variant="body" color={t.colors.onSurfaceVariant}>Nothing in Recently Deleted</Text>
          </View>
        </>
      ) : (
        <PhotoGrid
          photos={photos}
          renderHeader={header}
          onPressPhoto={(photo) => {
            setViewerList(photos);
            router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
          }}
        />
      )}
    </SafeAreaView>
  );
}
