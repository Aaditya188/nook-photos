/**
 * Live Photo in the viewer: the still by default, with a LIVE badge. Press and
 * hold the badge to play the paired motion clip (muted, once), release to revert.
 * The motion player is created lazily — only while actually playing — so a pager
 * full of Live Photos never preloads a video per page.
 */
import { useEffect, useState } from 'react';
import { View, Pressable, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useNookClient, type PhotoRecord } from '@nook/core';
import { RemoteOriginal } from './RemoteImage';
import { Text } from './ui';

export function LivePhoto({
  photo,
  width,
  height,
}: {
  photo: PhotoRecord;
  width: number;
  height: number;
}) {
  const [playing, setPlaying] = useState(false);

  const badge: ViewStyle = {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  };

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <RemoteOriginal photoId={photo.id} style={{ width, height }} contentFit="contain" />
      {playing ? (
        <LiveMotion photo={photo} width={width} height={height} onEnd={() => setPlaying(false)} />
      ) : null}
      <Pressable
        onPressIn={() => setPlaying(true)}
        onPressOut={() => setPlaying(false)}
        hitSlop={8}
        style={badge}
      >
        <MaterialIcons name="motion-photos-on" size={16} color="#fff" />
        <Text variant="caption" color="#fff" style={{ fontWeight: '700', letterSpacing: 0.4 }}>
          LIVE
        </Text>
      </Pressable>
    </View>
  );
}

/** Mounted only while playing; plays the motion clip once, then calls onEnd. */
function LiveMotion({
  photo,
  width,
  height,
  onEnd,
}: {
  photo: PhotoRecord;
  width: number;
  height: number;
  onEnd: () => void;
}) {
  const client = useNookClient();
  const player = useVideoPlayer(
    { uri: client.motionUrl(photo.id), headers: client.authHeaders() },
    (p) => {
      p.loop = false;
      p.muted = true;
      p.play();
    },
  );

  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);

  return (
    <VideoView
      player={player}
      style={{ position: 'absolute', top: 0, left: 0, width, height }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}
