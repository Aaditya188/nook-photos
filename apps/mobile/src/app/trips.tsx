/**
 * Trips — client-detected trips (shared @nook/core detectTrips) shown as big
 * cover cards with a date-range title and photo count. Mirrors web /trips.
 */
import { useMemo } from 'react';
import { View, Pressable, FlatList } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useLibrary, detectTrips, tripTitle } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, BrandLoader, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/theme';

export default function TripsScreen() {
  const t = useTheme();
  const library = useLibrary();
  const trips = useMemo(() => detectTrips(library.data ?? []), [library.data]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Trips"
        right={trips.length ? <Text variant="caption" color={t.colors.onSurfaceVariant}>{trips.length} {trips.length === 1 ? 'trip' : 'trips'}</Text> : undefined}
      />

      {library.isLoading ? (
        <BrandLoader label="Finding your trips…" />
      ) : trips.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.spacing.xl, gap: t.spacing.md }}>
          <MaterialIcons name="luggage" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            No trips yet. Trips appear automatically from photos taken away from home.
          </Text>
        </View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(tr) => tr.id}
          contentContainerStyle={{ padding: t.spacing.md, gap: t.spacing.md, paddingBottom: t.spacing.xxl }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/trip/[id]', params: { id: item.id } })}
              style={{ borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
              <RemoteThumb photoId={item.cover.id} displaySize={360} style={{ width: '100%', height: 170 }} />
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: t.spacing.md, backgroundColor: 'rgba(0,0,0,0.35)' }}>
                <Text variant="titleSmall" color="#fff">{tripTitle(item)}</Text>
                <Text variant="caption" color="rgba(255,255,255,0.85)">
                  {Math.round((item.end.getTime() - item.start.getTime()) / 86400000) + 1} days · {item.photos.length} items
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
