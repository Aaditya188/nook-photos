import { useState } from 'react';
import { View, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useSearch } from '@nook/core';
import { PhotoGrid } from '@/components/PhotoGrid';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export default function SearchScreen() {
  const t = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const results = useSearch(query);
  const setViewerList = useViewer((s) => s.setList);

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
      ) : (results.data ?? []).length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="body" color={t.colors.onSurfaceVariant}>No matches for “{query}”</Text>
        </View>
      ) : (
        <PhotoGrid
          photos={results.data ?? []}
          onPressPhoto={(photo) => {
            setViewerList(results.data ?? []);
            router.push({ pathname: '/photo/[id]', params: { id: photo.id } });
          }}
        />
      )}
    </SafeAreaView>
  );
}
