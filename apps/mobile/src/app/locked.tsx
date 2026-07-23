import { useMemo } from 'react';
import { useLibrary } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';
import { BiometricGate } from '@/components/BiometricGate';

/**
 * "Locked" is a biometric-gated view. The server has no separate locked-album
 * concept yet, so it surfaces favorites behind authentication as a private space;
 * this can move to a dedicated server flag later without changing the UI.
 */
export default function LockedScreen() {
  const library = useLibrary();
  const photos = useMemo(
    () => (library.data ?? []).filter((p) => p.favorite && p.uploadState === 'complete'),
    [library.data],
  );
  return (
    <BiometricGate title="Locked">
      <CollectionScreen
        title="Locked"
        subtitle={`${photos.length} items`}
        photos={photos}
        loading={library.isLoading}
        emptyIcon="lock"
        emptyText="Nothing locked yet"
      />
    </BiometricGate>
  );
}
