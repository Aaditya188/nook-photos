import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useLibrary, type PhotoRecord } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';

const FILTERS: Record<string, { title: string; test: (p: PhotoRecord) => boolean }> = {
  videos: { title: 'Videos', test: (p) => p.mediaType === 'video' },
  portraits: { title: 'Portraits', test: (p) => p.portrait },
  screenshots: { title: 'Screenshots', test: (p) => p.screenshot },
  panoramas: { title: 'Panoramas', test: (p) => p.panorama },
  live: { title: 'Live Photos', test: (p) => p.live },
  favorites: { title: 'Favorites', test: (p) => p.favorite },
};

export default function CategoryScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const library = useLibrary();
  const filter = FILTERS[type ?? 'videos'] ?? FILTERS.videos;

  const photos = useMemo(
    () => (library.data ?? []).filter((p) => !p.hidden && p.uploadState === 'complete' && filter.test(p)),
    [library.data, filter],
  );

  return (
    <CollectionScreen
      title={filter.title}
      subtitle={`${photos.length} items`}
      photos={photos}
      loading={library.isLoading}
    />
  );
}
