/**
 * The photo grid — two layouts behind one API:
 *  • grouped (default off): a day-sectioned grid with sticky date headers, matching
 *    the web app's Google-Photos timeline (Today / Yesterday / Month D).
 *  • zoomable: pinch between column counts (react-native-zoom-grid) for collections.
 * Each cell requests a thumbnail sized to the cell so we never over-fetch. Tapping
 * opens the viewer; long-press (or Select mode) toggles selection.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Pressable, Text as RNText, SectionList, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { ZoomGrid } from 'react-native-zoom-grid';
import type { PhotoRecord } from '@nook/core';
import { formatDuration, groupByDay } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

const GAP = 2;

type CellFrame = { x: number; y: number; w: number; h: number };

type GridProps = {
  photos: PhotoRecord[];
  onPressPhoto: (photo: PhotoRecord, index: number) => void;
  selectionMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Explicit set (used by drag-select so a pass doesn't un-toggle). */
  onSetSelect?: (id: string, on: boolean) => void;
  /** Enter selection mode (drag-select can start from a normal grid). */
  onEnterSelect?: () => void;
  renderHeader?: () => React.ReactNode;
  onEndReached?: () => void;
  /** Day-sectioned timeline with sticky date headers (web parity). */
  grouped?: boolean;
  /** Columns in grouped mode (default 3). */
  columns?: number;
};

/** A single thumbnail cell — shared by both layouts. */
function Cell({
  item,
  index,
  size,
  onPressPhoto,
  selectionMode,
  isSelected,
  onToggleSelect,
  registerFrame,
  disableLongPress,
}: {
  item: PhotoRecord;
  index: number;
  size: number;
  onPressPhoto: (photo: PhotoRecord, index: number) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect?: (id: string) => void;
  /** Report/clear this cell's window rect so drag-select can hit-test it. */
  registerFrame?: (id: string, frame: CellFrame | null) => void;
  disableLongPress?: boolean;
}) {
  const t = useTheme();
  const cell = size - GAP;
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!registerFrame) return;
    return () => registerFrame(item.id, null); // drop this cell's rect when it unmounts
  }, [registerFrame, item.id]);
  return (
    <Pressable
      ref={registerFrame ? ref : undefined}
      onPress={() => (selectionMode ? onToggleSelect?.(item.id) : onPressPhoto(item, index))}
      onLongPress={disableLongPress ? undefined : () => onToggleSelect?.(item.id)}
      onLayout={
        registerFrame
          ? () => ref.current?.measureInWindow((x, y, w, h) => registerFrame(item.id, { x, y, w, h }))
          : undefined
      }
      style={{ width: size, height: size, padding: GAP / 2 }}>
      <View style={{ flex: 1, borderRadius: 5, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
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
}

export function PhotoGrid(props: GridProps) {
  if (props.grouped) return <GroupedGrid {...props} />;
  return <ZoomableGrid {...props} />;
}

/** Day-sectioned timeline with sticky headers — the default web-parity layout. */
function GroupedGrid({
  photos,
  onPressPhoto,
  selectionMode = false,
  selected,
  onToggleSelect,
  onSetSelect,
  onEnterSelect,
  renderHeader,
  onEndReached,
  columns = 3,
}: GridProps) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - GAP * (columns - 1)) / columns);

  // ---- Drag-to-select (Apple/Google Photos style) ----
  // A long-press activates a pan; dragging across cells applies one action
  // (select if the first cell was unselected, else deselect). Enabled only when
  // the screen provides onSetSelect. A quick swipe still scrolls the list — the
  // pan only activates after a short hold, so scrolling is unaffected.
  const dragEnabled = !!onSetSelect;
  const frames = useRef(new Map<string, CellFrame>());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const dragMode = useRef(true);
  const lastId = useRef<string | null>(null);

  const registerFrame = useCallback((id: string, frame: CellFrame | null) => {
    if (frame) frames.current.set(id, frame);
    else frames.current.delete(id);
  }, []);

  const hitTest = useCallback((x: number, y: number): string | null => {
    for (const [id, f] of frames.current) {
      if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h) return id;
    }
    return null;
  }, []);

  const applyAt = useCallback(
    (x: number, y: number, isStart: boolean) => {
      const id = hitTest(x, y);
      if (!id) return;
      if (isStart) {
        onEnterSelect?.();
        dragMode.current = !(selectedRef.current?.has(id) ?? false);
        lastId.current = null;
      }
      if (id !== lastId.current) {
        onSetSelect?.(id, dragMode.current);
        lastId.current = id;
      }
    },
    [hitTest, onEnterSelect, onSetSelect],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(180)
        .runOnJS(true)
        .onStart((e) => applyAt(e.absoluteX, e.absoluteY, true))
        .onUpdate((e) => applyAt(e.absoluteX, e.absoluteY, false))
        .onEnd(() => {
          lastId.current = null;
        }),
    [applyAt],
  );

  // A flat index across all photos lets the viewer open at the right position.
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [photos]);

  // Sections whose `data` is rows (arrays of up to `columns` photos).
  const sections = useMemo(() => {
    return groupByDay(photos).map((sec) => {
      const rows: PhotoRecord[][] = [];
      for (let i = 0; i < sec.photos.length; i += columns) rows.push(sec.photos.slice(i, i + columns));
      return { key: sec.key, title: sec.title, data: rows };
    });
  }, [photos, columns]);

  const renderRow = useCallback(
    ({ item: row }: { item: PhotoRecord[] }) => (
      <View style={{ flexDirection: 'row' }}>
        {row.map((p) => (
          <Cell
            key={p.id}
            item={p}
            index={indexOf.get(p.id) ?? 0}
            size={size}
            onPressPhoto={onPressPhoto}
            selectionMode={selectionMode}
            isSelected={selected?.has(p.id) ?? false}
            onToggleSelect={onToggleSelect}
            registerFrame={dragEnabled ? registerFrame : undefined}
            disableLongPress={dragEnabled}
          />
        ))}
      </View>
    ),
    [indexOf, size, onPressPhoto, selectionMode, selected, onToggleSelect, dragEnabled, registerFrame],
  );

  const list = (
    <SectionList
      sections={sections}
      keyExtractor={(row, i) => (row[0]?.id ?? 'r') + ':' + i}
      renderItem={renderRow}
      renderSectionHeader={({ section }) => (
        <View style={{ backgroundColor: t.colors.background, paddingHorizontal: 12, paddingTop: t.spacing.md, paddingBottom: t.spacing.xs }}>
          <Text variant="titleSmall">{(section as { title: string }).title}</Text>
        </View>
      )}
      ListHeaderComponent={renderHeader ? <>{renderHeader()}</> : undefined}
      stickySectionHeadersEnabled
      onEndReached={onEndReached}
      onEndReachedThreshold={1.2}
      initialNumToRender={12}
      windowSize={9}
      removeClippedSubviews={false}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  );

  // A quick swipe still scrolls (the pan only activates after a short hold).
  return dragEnabled ? <GestureDetector gesture={pan}>{list}</GestureDetector> : list;
}

/** Pinch-zoomable flat grid — used by collections (albums, people, places…). */
function ZoomableGrid({
  photos,
  onPressPhoto,
  selectionMode = false,
  selected,
  onToggleSelect,
  renderHeader,
  onEndReached,
}: GridProps) {
  const renderItem = useCallback(
    ({ item, index, size }: { item: PhotoRecord; index: number; size: number }) => (
      <Cell
        item={item}
        index={index}
        size={size}
        onPressPhoto={onPressPhoto}
        selectionMode={selectionMode}
        isSelected={selected?.has(item.id) ?? false}
        onToggleSelect={onToggleSelect}
      />
    ),
    [selectionMode, selected, onToggleSelect, onPressPhoto],
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
