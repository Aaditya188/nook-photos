/**
 * The zoomable photo grid — pinch to move between column counts (Apple Photos
 * feel) via react-native-zoom-grid. Each cell requests a thumbnail sized to the
 * current cell so we never over-fetch. Tapping opens the viewer; long-press (or
 * Select mode) toggles selection.
 */
import { useCallback } from 'react';
import { View, Pressable, Text as RNText } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ZoomGrid } from 'react-native-zoom-grid';
import type { PhotoRecord } from '@nook/core';
import { formatDuration } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { useTheme } from '@/theme';

const GAP = 2;

export function PhotoGrid({
  photos,
  onPressPhoto,
  selectionMode = false,
  selected,
  onToggleSelect,
  renderHeader,
  onEndReached,
}: {
  photos: PhotoRecord[];
  onPressPhoto: (photo: PhotoRecord, index: number) => void;
  selectionMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  renderHeader?: () => React.ReactNode;
  onEndReached?: () => void;
}) {
  const t = useTheme();

  const renderItem = useCallback(
    ({ item, index, size }: { item: PhotoRecord; index: number; size: number }) => {
      const isSelected = selected?.has(item.id) ?? false;
      const cell = size - GAP;
      return (
        <Pressable
          onPress={() => (selectionMode ? onToggleSelect?.(item.id) : onPressPhoto(item, index))}
          onLongPress={() => onToggleSelect?.(item.id)}
          style={{ width: size, height: size, padding: GAP / 2 }}>
          <View style={{ flex: 1, borderRadius: 3, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
            <RemoteThumb photoId={item.id} displaySize={cell} style={{ width: '100%', height: '100%' }} />
            {item.mediaType === 'video' ? (
              <View style={styles.videoBadge}>
                <MaterialIcons name="play-arrow" size={13} color="#fff" />
                {item.duration != null ? (
                  <RNText style={styles.videoDuration}>{formatDuration(item.duration)}</RNText>
                ) : null}
              </View>
            ) : null}
            {item.favorite ? (
              <MaterialIcons name="favorite" size={14} color="#fff" style={styles.favBadge} />
            ) : null}
            {selectionMode ? (
              <View
                style={[
                  styles.selectDot,
                  {
                    backgroundColor: isSelected ? t.colors.primaryContainer : 'rgba(0,0,0,0.35)',
                    borderColor: '#fff',
                  },
                ]}>
                {isSelected ? <MaterialIcons name="check" size={14} color={t.colors.onPrimary} /> : null}
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [selectionMode, selected, onToggleSelect, onPressPhoto, t],
  );

  return (
    <ZoomGrid<PhotoRecord>
      data={photos}
      invert={false}
      initialNumColumns={3}
      zoomLevels={[7, 5, 3, 2]}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      renderHeader={renderHeader ? () => renderHeader() : undefined}
      onEndReached={onEndReached}
      contentInsets={{ bottom: 24 }}
    />
  );
}

const styles = {
  videoBadge: {
    position: 'absolute' as const,
    bottom: 4,
    left: 4,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  videoDuration: { color: '#fff', fontSize: 10, fontWeight: '600' as const, marginLeft: 1, marginRight: 2 },
  favBadge: { position: 'absolute' as const, bottom: 4, right: 4, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 2 },
  selectDot: {
    position: 'absolute' as const,
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};
