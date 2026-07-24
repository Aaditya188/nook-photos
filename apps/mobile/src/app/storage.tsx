/**
 * Storage — client-side usage breakdown (photos vs videos, by year, largest
 * items) over the library. Mirrors the web Storage view via shared @nook/core.
 */
import { useMemo } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary, useStatus, storageInsights, humanBytes } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, Card, BrandLoader, ScreenHeader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

const n = (v: number) => v.toLocaleString('en-US');

export default function StorageScreen() {
  const t = useTheme();
  const library = useLibrary();
  const status = useStatus();
  const setViewerList = useViewer((s) => s.setList);
  const ins = useMemo(() => storageInsights(library.data ?? []), [library.data]);
  const st = status.data?.storage;
  const maxYear = Math.max(1, ...ins.byYear.map((y) => y.bytes));

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Storage" />
      {library.isLoading ? (
        <BrandLoader label="Measuring your library…" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }}>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Card style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{humanBytes(ins.photos.bytes)}</Text>
              <Text variant="caption" color={t.colors.onSurfaceVariant}>{n(ins.photos.count)} photos</Text>
            </Card>
            <Card style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{humanBytes(ins.videos.bytes)}</Text>
              <Text variant="caption" color={t.colors.onSurfaceVariant}>{n(ins.videos.count)} videos</Text>
            </Card>
          </View>

          <Card style={{ gap: t.spacing.sm }}>
            <Text variant="titleSmall">{humanBytes(ins.total.bytes)} used{st ? ` of ${humanBytes(st.totalBytes)}` : ''}</Text>
            {st && st.totalBytes > 0 ? (
              <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceContainerHigh, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, (st.usedBytes / st.totalBytes) * 100)}%`, height: '100%', backgroundColor: t.colors.primaryContainer }} />
              </View>
            ) : null}
            <Text variant="caption" color={t.colors.onSurfaceVariant}>{n(ins.total.count)} items total</Text>
          </Card>

          {ins.byYear.length ? (
            <View style={{ gap: t.spacing.md }}>
              <Text variant="titleSmall">By year</Text>
              {ins.byYear.map((y) => (
                <View key={y.year} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="label">{y.year}</Text>
                    <Text variant="caption" color={t.colors.onSurfaceVariant}>{humanBytes(y.bytes)} · {n(y.count)}</Text>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: t.colors.surfaceContainerHigh, overflow: 'hidden' }}>
                    <View style={{ width: `${(y.bytes / maxYear) * 100}%`, height: '100%', backgroundColor: t.colors.primaryContainer }} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {ins.largest.length ? (
            <View style={{ gap: t.spacing.md }}>
              <Text variant="titleSmall">Largest items</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {ins.largest.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => { setViewerList(ins.largest); router.push({ pathname: '/photo/[id]', params: { id: p.id } }); }}
                    style={{ width: '31%', gap: 3 }}>
                    <RemoteThumb photoId={p.id} displaySize={120} style={{ width: '100%', aspectRatio: 1, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceContainerHigh }} />
                    <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>{humanBytes(p.bytes)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
