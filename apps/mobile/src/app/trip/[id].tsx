/**
 * Trip detail — the full grid of a detected trip's photos. Mirrors web /trip/:id.
 */
import { useMemo } from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useLibrary, detectTrips, tripTitle } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useLibrary();
  const trips = useMemo(() => detectTrips(library.data ?? []), [library.data]);
  const trip = trips.find((tr) => tr.id === id) ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CollectionScreen
        title={trip ? tripTitle(trip) : 'Trip'}
        subtitle={trip ? `${trip.photos.length} items` : undefined}
        photos={trip?.photos ?? []}
        loading={library.isLoading}
        emptyIcon="luggage"
        emptyText="This trip has no photos."
      />
    </>
  );
}
