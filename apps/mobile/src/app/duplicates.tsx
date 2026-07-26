/**
 * Duplicates — likely-duplicate sets (identical bytes + dimensions + type) with
 * per-copy selection (keep-newest by default) and a bulk delete that reclaims
 * space. Mirrors the web Duplicates view via shared @nook/core.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, Alert } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useLibrary, useDeletePhoto, findDuplicateGroups, humanBytes } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, Card, Button, BrandLoader, ScreenHeader } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export default function DuplicatesScreen() {
  const t = useTheme();
  const library = useLibrary();
  const del = useDeletePhoto();
  const setViewerList = useViewer((s) => s.setList);
  const groups = useMemo(() => findDuplicateGroups(library.data ?? []), [library.data]);
  const flat = useMemo(() => groups.flatMap((g) => g.photos), [groups]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    const s = new Set<string>();
    for (const g of groups) g.photos.slice(1).forEach((p) => s.add(p.id));
    setSelected(s);
  }, [groups]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const freed = flat.filter((p) => selected.has(p.id)).reduce((s, p) => s + (p.bytes || 0), 0);

  function removeSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    Alert.alert(
      `Delete ${ids.length} ${ids.length === 1 ? 'copy' : 'copies'}?`,
      `They move to Recently Deleted and free about ${humanBytes(freed)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of ids) await del.mutateAsync(id).catch(() => {});
            setSelected(new Set());
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Duplicates" />
      {library.isLoading ? (
        <BrandLoader label="Scanning for duplicates…" />
      ) : groups.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md, padding: t.spacing.xl }}>
          <MaterialIcons name="done-all" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            No duplicates found. Nook groups items that share an identical size and dimensions.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, paddingBottom: 96 }}>
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text variant="title">{groups.length}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>duplicate {groups.length === 1 ? 'set' : 'sets'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="title">{humanBytes(groups.reduce((s, g) => s + g.wastedBytes, 0))}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>reclaimable</Text>
              </View>
            </Card>

            {groups.map((g) => (
              <View key={g.key} style={{ gap: t.spacing.sm }}>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>
                  {g.photos.length} copies · {humanBytes(g.photos[0].bytes)} each · frees {humanBytes(g.wastedBytes)}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                  {g.photos.map((p, i) => {
                    const on = selected.has(p.id);
                    return (
                      <View key={p.id} style={{ width: 96 }}>
                        <Pressable onLongPress={() => { setViewerList(flat); router.push({ pathname: '/photo/[id]', params: { id: p.id } }); }} onPress={() => toggle(p.id)}>
                          <RemoteThumb
                            photoId={p.id}
                            displaySize={96}
                            style={{ width: 96, height: 96, borderRadius: t.radius.md, borderWidth: on ? 2 : 0, borderColor: t.colors.error, backgroundColor: t.colors.surfaceContainerHigh }}
                          />
                          <View style={{ position: 'absolute', top: 5, right: 5, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.error : 'rgba(0,0,0,0.5)', borderWidth: on ? 0 : 1.5, borderColor: 'rgba(255,255,255,0.7)' }}>
                            <Text variant="caption" color={on ? t.colors.onPrimary : '#fff'} style={{ fontWeight: '700' }}>{on ? '✕' : i === 0 ? 'keep' : '○'}</Text>
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          {selected.size > 0 ? (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: t.spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.colors.surfaceContainerHighest, borderTopWidth: 0.5, borderTopColor: t.colors.outlineVariant, gap: t.spacing.md }}>
              <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ flex: 1 }}>{selected.size} selected · frees {humanBytes(freed)}</Text>
              <Button title="Delete copies" variant="danger" loading={del.isPending} onPress={removeSelected} />
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}
