import { View, Pressable, FlatList } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { usePeople, usePlaces } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export default function PeopleIndex() {
  const t = useTheme();
  const people = usePeople();
  const places = usePlaces();

  const items = [
    ...(people.data ?? []).map((p) => ({ kind: 'person' as const, id: p.id, label: p.name ?? 'Person', count: p.count, cover: p.coverPhotoId })),
    ...(places.data ?? []).map((pl) => ({ kind: 'place' as const, id: pl.label, label: pl.label.split(',')[0]!, count: pl.count, cover: pl.coverPhotoId })),
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title">People &amp; Places</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => `${it.kind}-${it.id}`}
        numColumns={3}
        contentContainerStyle={{ padding: t.spacing.md, gap: t.spacing.lg }}
        columnWrapperStyle={{ gap: t.spacing.lg }}
        renderItem={({ item }) => (
          <Pressable
            style={{ flex: 1 / 3, alignItems: 'center' }}
            onPress={() =>
              item.kind === 'person'
                ? router.push({ pathname: '/people/[id]', params: { id: item.id, name: item.label } })
                : router.push({ pathname: '/place/[label]', params: { label: item.id } })
            }>
            <RemoteThumb photoId={item.cover} displaySize={96} style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: t.colors.surfaceContainerHigh }} />
            <Text variant="caption" numberOfLines={1} style={{ marginTop: 6 }}>{item.label}</Text>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>{item.count}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
