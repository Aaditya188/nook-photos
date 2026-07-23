/**
 * Custom, lightweight video player on expo-video. Own controls (play/pause, scrub
 * bar, time) and a strong buffering state — a spinner overlay whenever the player
 * isn't ready/is loading, so slow chunks never look like a frozen screen. Streams
 * via the gateway's Range endpoint (chunked), so seeking doesn't pull the whole file.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useNookClient, formatDuration, type PhotoRecord } from '@nook/core';
import { Text } from '@/components/ui';

export function VideoPlayer({ photo, active }: { photo: PhotoRecord; active: boolean }) {
  const client = useNookClient();
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(photo.duration ?? 0);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const player = useVideoPlayer(
    { uri: client.streamUrl(photo.id), headers: client.authHeaders() },
    (p) => {
      p.loop = false;
      p.timeUpdateEventInterval = 0.25;
    },
  );

  useEffect(() => {
    const subs = [
      player.addListener('statusChange', ({ status }) => {
        setLoading(status === 'loading' || status === 'idle');
        if (status === 'readyToPlay' && player.duration) setDuration(player.duration);
      }),
      player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying)),
      player.addListener('timeUpdate', ({ currentTime }) => setCurrent(currentTime)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // Pause when this page isn't the active pager item.
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  function toggleControls() {
    setControls((c) => !c);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!controls) hideTimer.current = setTimeout(() => setControls(false), 3000);
  }

  function togglePlay() {
    if (player.playing) player.pause();
    else player.play();
  }

  const pct = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <Pressable onPress={toggleControls} style={{ width, height, backgroundColor: '#000' }}>
      <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls={false} />

      {loading ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ padding: 16, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color="#fff" size="large" />
            <Text variant="caption" color="rgba(255,255,255,0.85)">Loading video…</Text>
          </View>
        </View>
      ) : null}

      {controls && !loading ? (
        <>
          <Pressable
            onPress={togglePlay}
            style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -32, marginTop: -32, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={40} color="#fff" />
          </Pressable>

          <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text variant="caption" color="#fff">{formatDuration(current) ?? '0:00'}</Text>
            <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: '#fff' }} />
            </View>
            <Text variant="caption" color="#fff">{formatDuration(duration) ?? '0:00'}</Text>
          </View>
        </>
      ) : null}
    </Pressable>
  );
}
