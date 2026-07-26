import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, useWindowDimensions, StatusBar, Alert, Modal } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  useNookClient,
  usePatchPhoto,
  useDeletePhoto,
  useRestorePhoto,
  usePermanentDelete,
  humanBytes,
  formatAperture,
  formatExposure,
  formatFocal,
  formatIso,
  type PhotoRecord,
} from '@nook/core';
import { LivePhoto } from '@/components/LivePhoto';
import { VideoPlayer } from '@/components/VideoPlayer';
import { ZoomableImage } from '@/components/ZoomableImage';
import { Text } from '@/components/ui';
import { useViewer } from '@/store/viewer';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function PhotoViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const client = useNookClient();
  const { width, height } = useWindowDimensions();
  const photos = useViewer((s) => s.photos);
  const patch = usePatchPhoto();
  const del = useDeletePhoto();
  const restore = useRestorePhoto();
  const permaDelete = usePermanentDelete();

  const startIndex = Math.max(0, photos.findIndex((p) => p.id === id));
  const [index, setIndex] = useState(startIndex);
  const [chrome, setChrome] = useState(true);
  const [info, setInfo] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<FlatList<PhotoRecord>>(null);

  const current = photos[index] ?? photos[startIndex];

  // Single tap on the media: stop a running slideshow, else toggle the chrome.
  function onTapMedia() {
    if (slideshow) {
      setSlideshow(false);
      setChrome(true);
    } else {
      setChrome((c) => !c);
    }
  }

  // Slideshow: auto-advance every 4s (wrapping), chrome hidden. Any tap stops it.
  useEffect(() => {
    if (!slideshow || photos.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % photos.length;
        listRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [slideshow, photos.length]);

  // Share the original: download to cache (authed), then hand off to the OS sheet.
  async function shareCurrent() {
    if (sharing || !(await Sharing.isAvailableAsync())) return;
    setSharing(true);
    try {
      const safe = current.filename.replace(/[^\w.\-]+/g, '_') || `${current.id}.jpg`;
      const dest = `${FileSystem.cacheDirectory}${safe}`;
      const dl = await FileSystem.downloadAsync(client.originalUrl(current.id), dest, {
        headers: client.authHeaders(),
      });
      // downloadAsync resolves even on 401/404, writing the error body to disk —
      // don't share a corrupt file.
      if (dl.status < 200 || dl.status >= 300) throw new Error(`HTTP ${dl.status}`);
      await Sharing.shareAsync(dl.uri);
    } catch {
      Alert.alert('Could not share', 'The original could not be downloaded to share.');
    }
    setSharing(false);
  }

  function trashCurrent() {
    const doDelete = () => {
      del.mutate(current.id);
      router.back();
    };
    if (useSettings.getState().prefs.confirmDelete) {
      Alert.alert('Delete this item?', 'It moves to Recently Deleted.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    } else {
      doDelete();
    }
  }

  function deletePermanent() {
    Alert.alert(
      'Delete permanently?',
      'This removes the photo from your server for good. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            permaDelete.mutate(current.id);
            router.back();
          },
        },
      ],
    );
  }

  // Everything the "⋯" menu offers, adapted to whether the photo is trashed.
  type Action = { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void; danger?: boolean };
  const actions: Action[] = current.deletedAt != null
    ? [
        { icon: 'info-outline', label: 'Info', onPress: () => setInfo((v) => !v) },
        { icon: 'restore-from-trash', label: 'Restore', onPress: () => { restore.mutate(current.id); router.back(); } },
        { icon: 'delete-forever', label: 'Delete permanently', onPress: deletePermanent, danger: true },
      ]
    : [
        { icon: current.favorite ? 'favorite' : 'favorite-border', label: current.favorite ? 'Remove favorite' : 'Favorite', onPress: () => patch.mutate({ id: current.id, favorite: !current.favorite }) },
        { icon: 'ios-share', label: 'Share', onPress: shareCurrent },
        { icon: 'add-to-photos', label: 'Add to album', onPress: () => router.push({ pathname: '/add-to-album', params: { ids: current.id } }) },
        ...(current.mediaType !== 'video'
          ? [{ icon: 'tune' as const, label: 'Edit', onPress: () => router.push({ pathname: '/edit/[id]', params: { id: current.id } }) }]
          : []),
        ...(photos.length > 1
          ? [{ icon: 'slideshow' as const, label: 'Slideshow', onPress: () => { setSlideshow(true); setChrome(false); setInfo(false); } }]
          : []),
        { icon: current.hidden ? 'visibility' : 'visibility-off', label: current.hidden ? 'Unhide' : 'Hide', onPress: () => patch.mutate({ id: current.id, hidden: !current.hidden }) },
        { icon: 'info-outline', label: 'Info', onPress: () => setInfo((v) => !v) },
        { icon: 'delete-outline', label: 'Delete', onPress: trashCurrent, danger: true },
      ];

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
        scrollEnabled={!zoomed}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.id}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) =>
          item.mediaType === 'video' ? (
            <Pressable onPress={onTapMedia} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <VideoPlayer photo={item} active={i === index} />
            </Pressable>
          ) : item.hasMotion ? (
            <Pressable onPress={onTapMedia} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <LivePhoto photo={item} width={width} height={height} />
            </Pressable>
          ) : (
            <ZoomableImage
              photoId={item.id}
              width={width}
              height={height}
              onTap={onTapMedia}
              onZoomChange={setZoomed}
            />
          )
        }
      />

      {chrome ? (
        <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: t.spacing.md }}>
            <IconBtn name="arrow-back" onPress={() => router.back()} />
            <IconBtn name="more-horiz" onPress={() => setMenuOpen(true)} />
          </View>
        </SafeAreaView>
      ) : null}

      {/* All actions live in this "⋯" sheet. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setMenuOpen(false)}>
          <SafeAreaView edges={['bottom']} style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{ margin: t.spacing.md, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.colors.surfaceContainerHighest }}
            >
              {actions.map((a, i) => (
                <View key={a.label}>
                  <Pressable
                    onPress={() => { setMenuOpen(false); a.onPress(); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: 16, paddingHorizontal: t.spacing.lg }}
                  >
                    <MaterialIcons name={a.icon} size={22} color={a.danger ? t.colors.error : t.colors.onSurface} />
                    <Text variant="body" color={a.danger ? t.colors.error : t.colors.onSurface}>{a.label}</Text>
                  </Pressable>
                  {i < actions.length - 1 ? <View style={{ height: 0.5, backgroundColor: t.colors.outlineVariant }} /> : null}
                </View>
              ))}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>

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

