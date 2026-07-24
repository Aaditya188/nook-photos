import { useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, useWindowDimensions, StatusBar } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import {
  usePatchPhoto,
  useDeletePhoto,
  humanBytes,
  formatAperture,
  formatExposure,
  formatFocal,
  formatIso,
  type PhotoRecord,
} from '@nook/core';
import { RemoteOriginal } from '@/components/RemoteImage';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useTheme } from '@/theme';

export default function PhotoViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const photos = useViewer((s) => s.photos);
  const patch = usePatchPhoto();
  const del = useDeletePhoto();

  const startIndex = Math.max(0, photos.findIndex((p) => p.id === id));
  const [index, setIndex] = useState(startIndex);
  const [chrome, setChrome] = useState(true);
  const [info, setInfo] = useState(false);
  const listRef = useRef<FlatList<PhotoRecord>>(null);

  const current = photos[index] ?? photos[startIndex];

  const detail = useMemo(() => {
    if (!current) return [];
    return [
      current.cameraModel && { icon: 'photo-camera', text: current.cameraModel },
      current.lensModel && { icon: 'camera', text: current.lensModel },
      [formatAperture(current.fNumber), formatExposure(current.exposureTime), formatIso(current.iso), formatFocal(current.focalLength)]
        .filter(Boolean)
        .join('  ·  ') && { icon: 'tune', text: [formatAperture(current.fNumber), formatExposure(current.exposureTime), formatIso(current.iso), formatFocal(current.focalLength)].filter(Boolean).join('  ·  ') },
      { icon: 'straighten', text: `${current.width} × ${current.height}  ·  ${humanBytes(current.bytes)}` },
      { icon: 'schedule', text: new Date(current.createdAt).toLocaleString() },
    ].filter(Boolean) as { icon: keyof typeof MaterialIcons.glyphMap; text: string }[];
  }, [current]);

  if (!current) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Text color="#fff">Photo unavailable</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden={!chrome} />

      <FlatList
        ref={listRef}
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.id}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <Pressable onPress={() => setChrome((c) => !c)} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
            {item.mediaType === 'video' ? (
              <VideoPlayer photo={item} active={i === index} />
            ) : (
              <RemoteOriginal photoId={item.id} style={{ width, height }} contentFit="contain" />
            )}
          </Pressable>
        )}
      />

      {chrome ? (
        <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: t.spacing.md }}>
            <IconBtn name="arrow-back" onPress={() => router.back()} />
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <IconBtn
                name={current.favorite ? 'favorite' : 'favorite-border'}
                color={current.favorite ? '#ff6b8a' : '#fff'}
                onPress={() => patch.mutate({ id: current.id, favorite: !current.favorite })}
              />
              <IconBtn name="add-to-photos" onPress={() => router.push({ pathname: '/add-to-album', params: { ids: current.id } })} />
              {current.mediaType !== 'video' ? (
                <IconBtn name="tune" onPress={() => router.push({ pathname: '/edit/[id]', params: { id: current.id } })} />
              ) : null}
              <IconBtn name="info-outline" onPress={() => setInfo((v) => !v)} />
              <IconBtn
                name="delete-outline"
                onPress={() => {
                  del.mutate(current.id);
                  router.back();
                }}
              />
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {chrome && info ? (
        <SafeAreaView edges={['bottom']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', margin: t.spacing.md, borderRadius: t.radius.lg, padding: t.spacing.lg, gap: t.spacing.sm }}>
            <Text variant="titleSmall" color="#fff" numberOfLines={1}>{current.filename}</Text>
            {detail.map((d, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
                <MaterialIcons name={d.icon} size={16} color="rgba(255,255,255,0.7)" />
                <Text variant="caption" color="rgba(255,255,255,0.85)" style={{ flex: 1 }}>{d.text}</Text>
              </View>
            ))}
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

function IconBtn({ name, onPress, color = '#fff' }: { name: keyof typeof MaterialIcons.glyphMap; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
      <MaterialIcons name={name} size={22} color={color} />
    </Pressable>
  );
}

