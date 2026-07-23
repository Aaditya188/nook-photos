/**
 * Horizontal "People & Places" rail on Library Home — circular face-cluster and
 * reverse-geocoded place covers. Pulls from the AI indexer via core hooks.
 */
import { View, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { usePeople, usePlaces } from '@nook/core';
import { RemoteThumb } from '@/components/RemoteImage';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

const AVATAR = 64;

export function PeopleRail() {
  const t = useTheme();
  const people = usePeople();
  const places = usePlaces();

  const loading = people.isLoading || places.isLoading;
  const peopleData = people.data ?? [];
  const placesData = places.data ?? [];

  if (!loading && peopleData.length === 0 && placesData.length === 0) return null;

  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">People &amp; Places</Text>
        {peopleData.length + placesData.length > 0 ? (
          <Pressable onPress={() => router.push('/people')}>
            <Text variant="label" color={t.colors.primaryContainer}>
              View all
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={{ height: AVATAR + 24, justifyContent: 'center' }}>
          <ActivityIndicator color={t.colors.primaryContainer} />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.lg, paddingRight: t.spacing.lg }}>
          {peopleData.map((p) => (
            <Pressable
              key={`person-${p.id}`}
              onPress={() => router.push({ pathname: '/people/[id]', params: { id: p.id, name: p.name ?? '' } })}
              style={{ alignItems: 'center', width: AVATAR }}>
              <RemoteThumb
                photoId={p.coverPhotoId}
                displaySize={AVATAR}
                style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: t.colors.surfaceContainerHigh }}
              />
              <Text variant="caption" numberOfLines={1} style={{ marginTop: 4 }}>
                {p.name ?? 'Person'}
              </Text>
            </Pressable>
          ))}

          {placesData.map((pl) => (
            <Pressable
              key={`place-${pl.label}`}
              onPress={() => router.push({ pathname: '/place/[label]', params: { label: pl.label } })}
              style={{ alignItems: 'center', width: AVATAR }}>
              <View style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHigh }}>
                <RemoteThumb photoId={pl.coverPhotoId} displaySize={AVATAR} style={{ width: '100%', height: '100%' }} />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="place" size={12} color="#fff" />
                </View>
              </View>
              <Text variant="caption" numberOfLines={1} style={{ marginTop: 4 }}>
                {pl.label.split(',')[0]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
