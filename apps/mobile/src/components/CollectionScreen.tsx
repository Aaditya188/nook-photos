/**
 * A titled, zoomable photo collection — reused by album / media-type / person /
 * place / search / deleted screens. Handles loading + empty states.
 */
import { View, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import type { PhotoRecord } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export function CollectionScreen({
  title,
  subtitle,
  photos,
  loading,
  emptyIcon = 'photo-library',
  emptyText = 'Nothing here yet',
  right,
}: {
  title: string;
  subtitle?: string;
  photos: PhotoRecord[];
  loading?: boolean;
  emptyIcon?: keyof typeof MaterialIcons.glyphMap;
  emptyText?: string;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const setViewerList = useViewer((s) => s.setList);

  const header = () => (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.md, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>{title}</Text>
        {right}
      </View>
      {subtitle ? (
        <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ marginLeft: 34 }}>{subtitle}</Text>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        {header()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.colors.primaryContainer} />
        </View>
      </SafeAreaView>
    );
  }

  if (photos.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        {header()}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm }}>
          <MaterialIcons name={emptyIcon} size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant}>{emptyText}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <PhotoGrid
        photos={photos}
        renderHeader={header}
        onPressPhoto={(photo) => {
          setViewerList(photos);
          router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
        }}
      />
    </SafeAreaView>
  );
}
