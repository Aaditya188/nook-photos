/**
 * Person detail — the person's photos, plus management (rename, merge into
 * another person, hide) matching the web PersonView. Uses the shared client's
 * people endpoints; invalidates the people cache after each change.
 */
import { useMemo, useState } from 'react';
import { View, Pressable, Alert, FlatList } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { usePersonPhotos, usePeople, useNookClient, qk } from '@nook/core';
import { CollectionScreen } from '@/components/CollectionScreen';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text, Card, Button, TextField, Divider } from '@/components/ui';
import { useTheme } from '@/theme';

export default function PersonScreen() {
  const t = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const client = useNookClient();
  const qc = useQueryClient();
  const photos = usePersonPhotos(id);
  const people = usePeople();
  const person = useMemo(() => (people.data ?? []).find((p) => p.id === id), [people.data, id]);
  const displayName = person?.name || name || 'Person';

  const [sheet, setSheet] = useState<null | 'menu' | 'rename' | 'merge'>(null);
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.people });
    qc.invalidateQueries({ queryKey: qk.personPhotos(id) });
  };

  async function doRename() {
    if (!rename.trim()) return;
    setBusy(true);
    try {
      await client.renamePerson(id, rename.trim());
      refresh();
      setSheet(null);
    } catch {
      Alert.alert('Could not rename');
    }
    setBusy(false);
  }

  async function doHide() {
    setSheet(null);
    try {
      await client.setPersonHidden(id, true);
      refresh();
      router.back();
    } catch {
      Alert.alert('Could not hide');
    }
  }

  async function doMerge(intoId: string, intoName: string) {
    Alert.alert('Merge people?', `Move all photos of "${displayName}" into "${intoName}". This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Merge',
        onPress: async () => {
          try {
            await client.mergePeople(id, intoId);
            refresh();
            router.back();
          } catch {
            Alert.alert('Could not merge');
          }
        },
      },
    ]);
  }

  const others = (people.data ?? []).filter((p) => p.id !== id);

  return (
    <>
      <CollectionScreen
        title={displayName}
        subtitle={photos.data ? `${photos.data.length} photos` : undefined}
        photos={photos.data ?? []}
        loading={photos.isLoading}
        emptyIcon="face"
        emptyText="No photos for this person"
        right={
          <Pressable onPress={() => { setRename(person?.name ?? ''); setSheet('menu'); }} hitSlop={8}>
            <MaterialIcons name="more-vert" size={24} color={t.colors.onSurface} />
          </Pressable>
        }
      />

      {sheet ? (
        <Pressable
          onPress={() => setSheet(null)}
          style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: t.colors.surfaceContainer, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: t.spacing.lg, paddingBottom: t.spacing.xxl, gap: t.spacing.md, maxHeight: '70%' }}>
            {sheet === 'menu' ? (
              <>
                <Text variant="title">{displayName}</Text>
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  <Row icon="edit" label={person?.name ? 'Rename' : 'Add name'} onPress={() => setSheet('rename')} />
                  <Divider />
                  <Row icon="merge-type" label="Merge into…" onPress={() => setSheet('merge')} />
                  <Divider />
                  <Row icon="visibility-off" label="Hide person" onPress={doHide} />
                </Card>
              </>
            ) : sheet === 'rename' ? (
              <>
                <Text variant="title">{person?.name ? 'Rename person' : 'Name this person'}</Text>
                <TextField label="NAME" value={rename} onChangeText={setRename} placeholder="Their name" autoFocus />
                <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                  <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSheet('menu')} />
                  <Button title="Save" style={{ flex: 1 }} loading={busy} onPress={doRename} />
                </View>
              </>
            ) : (
              <>
                <Text variant="title">Merge into…</Text>
                <FlatList
                  data={others}
                  keyExtractor={(p) => p.id}
                  style={{ maxHeight: 360 }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => doMerge(item.id, item.name || 'Person')} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.sm }}>
                      <RemoteThumb photoId={item.coverPhotoId} displaySize={44} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.surfaceContainerHigh }} />
                      <Text variant="body" style={{ flex: 1 }}>{item.name || 'Unnamed'}</Text>
                      <Text variant="caption" color={t.colors.onSurfaceVariant}>{item.count}</Text>
                    </Pressable>
                  )}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      ) : null}
    </>
  );
}

function Row({ icon, label, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
      <MaterialIcons name={icon} size={22} color={t.colors.onSurfaceVariant} />
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}
