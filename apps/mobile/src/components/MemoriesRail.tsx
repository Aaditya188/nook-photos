/**
 * Memories rail: server-generated collections (on-this-day, per-year, per-place,
 * per-person). The indexer builds these from photo metadata plus the faces/places
 * it already computed -- no models and no GPU on the host -- and the origin serves
 * them. We just render the cards and resolve each memory's photoIds against the
 * already-loaded library to feed the viewer, so opening one costs no extra fetch.
 */
import { useMemo } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useLibrary, useMemories, type PhotoRecord } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

const CARD_W = 124;
const CARD_H = 168;

export function MemoriesRail() {
  const t = useTheme();
  const memories = useMemories();
  const library = useLibrary();
  const setViewerList = useViewer((s) => s.setList);

  const byId = useMemo(() => {
    const m = new Map<string, PhotoRecord>();
    for (const p of library.data ?? []) m.set(p.id, p);
    return m;
  }, [library.data]);

  const items = memories.data ?? [];
  if (items.length === 0) return null;

  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="title">Memories</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.spacing.md, paddingRight: t.spacing.lg }}
      >
        {items.map((mem) => (
          <Pressable
            key={mem.id}
            onPress={() => {
              const list = mem.photoIds
                .map((id) => byId.get(id))
                .filter((p): p is PhotoRecord => !!p);
              if (list.length === 0) return;
              setViewerList(list);
              router.push({ pathname: '/photo/[id]', params: { id: list[0].id } });
            }}
            style={{
              width: CARD_W,
              height: CARD_H,
              borderRadius: 18,
              overflow: 'hidden',
              backgroundColor: t.colors.surfaceContainerHigh,
            }}
          >
            <RemoteThumb
              photoId={mem.coverPhotoId}
              displaySize={CARD_W * 2}
              style={{ width: '100%', height: '100%' }}
            />
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: 'rgba(0,0,0,0.45)',
              }}
            >
              <Text variant="label" color="#fff" numberOfLines={1}>
                {mem.title}
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>
                {mem.subtitle}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
