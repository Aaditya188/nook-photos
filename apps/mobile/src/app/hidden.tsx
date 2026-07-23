import { useMemo } from 'react';
import { useLibrary } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';
import { BiometricGate } from '@/components/BiometricGate';

export default function HiddenScreen() {
  const library = useLibrary();
  const photos = useMemo(() => (library.data ?? []).filter((p) => p.hidden && p.uploadState === 'complete'), [library.data]);
  return (
    <BiometricGate title="Hidden">
      <CollectionScreen
        title="Hidden"
        subtitle={`${photos.length} items`}
        photos={photos}
        loading={library.isLoading}
        emptyIcon="visibility-off"
        emptyText="No hidden photos"
      />
    </BiometricGate>
  );
}
