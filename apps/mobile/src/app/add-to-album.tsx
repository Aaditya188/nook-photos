import { useState } from 'react';
import { View, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlbums, useAddPhotosToAlbum, useCreateAlbum } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Screen, Text, Card, TextField, Button } from '@/components/ui';
import { useTheme } from '@/theme';

export default function AddToAlbum() {
  const t = useTheme();
  const { ids } = useLocalSearchParams<{ ids: string }>();
  const photoIds = (ids ?? '').split(',').filter(Boolean);
  const albums = useAlbums();
  const addTo = useAddPhotosToAlbum();
  const createAlbum = useCreateAlbum();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function add(albumId: string) {
    await addTo.mutateAsync({ albumId, photoIds });
    router.back();
  }
  async function createAndAdd() {
    if (!newName.trim()) return;
    const album = await createAlbum.mutateAsync(newName.trim());
    await add(album.id);
  }

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.lg }}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="headline">Add to Album</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="close" size={24} color={t.colors.onSurface} />
        </Pressable>
      </View>
      <Text variant="caption" color={t.colors.onSurfaceVariant}>
        {photoIds.length} photo{photoIds.length === 1 ? '' : 's'} selected
      </Text>

      {creating ? (
        <Card style={{ gap: t.spacing.md }}>
          <TextField label="ALBUM NAME" value={newName} onChangeText={setNewName} autoFocus />
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Create & Add" style={{ flex: 1 }} loading={createAlbum.isPending || addTo.isPending} onPress={createAndAdd} />
          </View>
        </Card>
      ) : (
        <Pressable
          onPress={() => setCreating(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceContainerLow }}>
          <MaterialIcons name="add" size={22} color={t.colors.primaryContainer} />
          <Text variant="body" color={t.colors.primaryContainer}>New Album</Text>
        </Pressable>
      )}

      {albums.isLoading ? (
        <ActivityIndicator color={t.colors.primaryContainer} />
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {(albums.data ?? []).map((a) => (
            <Pressable
              key={a.id}
              onPress={() => add(a.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.sm, borderRadius: t.radius.md }}>
              <View style={{ width: 52, height: 52, borderRadius: t.radius.sm, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
                {a.coverPhotoId ? <RemoteThumb photoId={a.coverPhotoId} displaySize={52} style={{ width: '100%', height: '100%' }} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body">{a.name}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>{a.photoCount} photos</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
