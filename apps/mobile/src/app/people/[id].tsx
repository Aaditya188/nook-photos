import { useLocalSearchParams } from 'expo-router';
import { usePersonPhotos } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';

export default function PersonScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const photos = usePersonPhotos(id);
  return (
    <CollectionScreen
      title={name || 'Person'}
      subtitle={photos.data ? `${photos.data.length} photos` : undefined}
      photos={photos.data ?? []}
      loading={photos.isLoading}
      emptyIcon="face"
      emptyText="No photos for this person"
    />
  );
}
