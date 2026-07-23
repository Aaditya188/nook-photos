import { useLocalSearchParams } from 'expo-router';
import { usePlacePhotos } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';

export default function PlaceScreen() {
  const { label } = useLocalSearchParams<{ label: string }>();
  const photos = usePlacePhotos(label);
  return (
    <CollectionScreen
      title={label ?? 'Place'}
      subtitle={photos.data ? `${photos.data.length} photos` : undefined}
      photos={photos.data ?? []}
      loading={photos.isLoading}
      emptyIcon="place"
      emptyText="No photos for this place"
    />
  );
}
