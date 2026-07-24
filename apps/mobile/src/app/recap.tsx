/**
 * Recap — a shareable "Your Year" screen: hero year, stats, monthly activity,
 * and highlight photos. Client-side via shared @nook/core recap logic.
 */
import { useMemo, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary, availableYears, recapForYear } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, BrandLoader, ScreenHeader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const n = (v: number) => v.toLocaleString('en-US');

export default function RecapScreen() {
  const t = useTheme();
  const library = useLibrary();
  const setViewerList = useViewer((s) => s.setList);
  const photos = library.data ?? [];
  const years = useMemo(() => availableYears(photos), [photos]);
  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? years[0] ?? new Date().getFullYear();
  const recap = useMemo(() => recapForYear(photos, activeYear), [photos, activeYear]);
  const maxMonth = Math.max(1, ...recap.byMonth);

  const stats = [
    { v: n(recap.photoCount), l: 'photos' },
    { v: n(recap.videoCount), l: 'videos' },
    { v: n(recap.favoriteCount), l: 'favorites' },
    { v: n(recap.activeDays), l: 'active days' },
    ...(recap.places > 0 ? [{ v: n(recap.places), l: 'places' }] : []),
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Recap" />
      {library.isLoading ? (
        <BrandLoader label="Looking back…" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }}>
          {years.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {years.map((y) => {
                const on = y === activeYear;
                return (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: t.radius.pill, backgroundColor: on ? t.colors.primaryContainer : t.colors.surfaceContainerHigh }}>
                    <Text variant="label" color={on ? t.colors.onPrimary : t.colors.onSurface}>{y}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={{ borderRadius: 20, padding: t.spacing.xl, backgroundColor: t.colors.surfaceContainer, borderWidth: 0.5, borderColor: t.colors.outlineVariant }}>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>Your year in photos</Text>
            <Text style={{ fontSize: 64, fontWeight: '800', letterSpacing: -2, color: t.colors.primaryContainer }}>{activeYear}</Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {stats.map((s) => (
              <View key={s.l} style={{ minWidth: '30%', flexGrow: 1, backgroundColor: t.colors.surfaceContainer, borderWidth: 0.5, borderColor: t.colors.outlineVariant, borderRadius: 14, padding: t.spacing.md }}>
                <Text variant="title">{s.v}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>{s.l}</Text>
              </View>
            ))}
          </View>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="titleSmall">Across the year</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110 }}>
              {recap.byMonth.map((c, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center', gap: 5, height: '100%' }}>
                  <View style={{ flex: 1, width: '100%', justifyContent: 'flex-end' }}>
                    <View style={{ width: '100%', height: `${(c / maxMonth) * 100}%`, minHeight: 2, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: t.colors.primaryContainer }} />
                  </View>
                  <Text variant="caption" color={t.colors.onSurfaceVariant}>{MONTHS[i]}</Text>
                </View>
              ))}
            </View>
            {recap.busiestDay ? (
              <Text variant="caption" color={t.colors.onSurfaceVariant}>
                Busiest day: {new Date(recap.busiestDay.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · {n(recap.busiestDay.count)} photos
              </Text>
            ) : null}
          </View>

          {recap.highlights.length ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="titleSmall">Highlights</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                {recap.highlights.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => { setViewerList(recap.highlights); router.push({ pathname: '/photo/[id]', params: { id: p.id } }); }}
                    style={{ width: '32%' }}>
                    <RemoteThumb photoId={p.id} displaySize={120} style={{ width: '100%', aspectRatio: 1, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceContainerHigh }} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <Text variant="caption" color={t.colors.onSurfaceVariant}>No photos from {activeYear} yet.</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
