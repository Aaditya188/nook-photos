import { useMemo, useState } from 'react';
import { View, Pressable, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useSearch } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

type Filter = 'all' | 'photo' | 'video' | 'fav';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photo', label: 'Photos' },
  { key: 'video', label: 'Videos' },
  { key: 'fav', label: 'Favorites' },
];

export default function SearchScreen() {
  const t = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const results = useSearch(query);
  const setViewerList = useViewer((s) => s.setList);

  const shown = useMemo(() => {
    const all = results.data ?? [];
    if (filter === 'photo') return all.filter((p) => p.mediaType !== 'video');
    if (filter === 'video') return all.filter((p) => p.mediaType === 'video');
    if (filter === 'fav') return all.filter((p) => p.favorite);
    return all;
  }, [results.data, filter]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 46,
            borderRadius: t.radius.pill,
            backgroundColor: t.colors.surfaceContainer,
            paddingHorizontal: t.spacing.lg,
          }}>
          <MaterialIcons name="search" size={20} color={t.colors.onSurfaceVariant} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => setQuery(text.trim())}
            returnKeyType="search"
            autoFocus
            placeholder="Search photos — e.g. beach, dog, sunset"
            placeholderTextColor={t.colors.outline}
            style={{ flex: 1, color: t.colors.onSurface, fontSize: 16 }}
          />
          {text ? (
            <Pressable onPress={() => { setText(''); setQuery(''); }} hitSlop={8}>
              <MaterialIcons name="close" size={20} color={t.colors.onSurfaceVariant} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {query.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm, paddingHorizontal: t.spacing.md, paddingBottom: t.spacing.sm }} style={{ flexGrow: 0 }}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={{ paddingVertical: 7, paddingHorizontal: 15, borderRadius: t.radius.pill, backgroundColor: on ? t.colors.primaryContainer : t.colors.surfaceContainerHigh }}>
                <Text variant="label" color={on ? t.colors.onPrimary : t.colors.onSurface}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {query.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
          <MaterialIcons name="image-search" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            Semantic search across your library. Try “sunset”, “documents”, a person or a place.
          </Text>
        </View>
      ) : results.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.colors.primaryContainer} />
        </View>
      ) : shown.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="body" color={t.colors.onSurfaceVariant}>
            {(results.data ?? []).length ? 'No ' + filter + ' matches' : 'No matches for “' + query + '”'}
          </Text>
        </View>
      ) : (
        <PhotoGrid
          photos={shown}
          onPressPhoto={(photo) => {
            setViewerList(shown);
            router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
          }}
        />
      )}
    </SafeAreaView>
  );
}
