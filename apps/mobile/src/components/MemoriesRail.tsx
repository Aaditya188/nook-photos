/**
 * Memories — "on this day": one card per previous year with photos taken on
 * today's month/day. Tapping a card opens that year's first photo.
 */
import { useMemo } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useLibrary, type PhotoRecord } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

const CARD_W = 124;
const CARD_H = 168;

export function MemoriesRail() {
  const t = useTheme();
  const library = useLibrary();
  const setViewerList = useViewer((s) => s.setList);

  const groups = useMemo(() => {
    const now = new Date();
    const m = now.getMonth();
    const d = now.getDate();
    const y = now.getFullYear();
    const byYear = new Map<number, PhotoRecord[]>();
    for (const p of library.data ?? []) {
      if (p.hidden) continue;
      const dt = new Date(p.createdAt);
      if (dt.getMonth() === m && dt.getDate() === d && dt.getFullYear() < y) {
        const arr = byYear.get(dt.getFullYear());
        if (arr) arr.push(p);
        else byYear.set(dt.getFullYear(), [p]);
      }
    }
    return [...byYear.entries()].sort((a, b) => b[0] - a[0]);
  }, [library.data]);

  if (groups.length === 0) return null;

  const thisYear = new Date().getFullYear();

  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="title">Memories</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.spacing.md, paddingRight: t.spacing.lg }}
      >
        {groups.map(([year, list]) => {
          const ago = thisYear - year;
          return (
            <Pressable
              key={year}
              onPress={() => {
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
                photoId={list[0].id}
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
                <Text variant="label" color="#fff">
                  {ago === 1 ? '1 year ago' : `${ago} years ago`}
                </Text>
                <Text variant="caption" color="rgba(255,255,255,0.75)">
                  {list.length} {list.length === 1 ? 'photo' : 'photos'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
