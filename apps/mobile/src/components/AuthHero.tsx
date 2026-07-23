/**
 * The brand moment atop the auth screens — mirrors the web AuthScreen hero:
 * an ambient aurora glow behind a drifting photo-mosaic, the nook mark +
 * wordmark, and the "Your photos. Your server. Nobody else's." tagline.
 * Pure-JS (Animated only) so it runs in Expo Go. Reused by the server-config
 * and login/setup screens for one continuous identity.
 */
import React from 'react';
import { Animated, Easing, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

// Six tint variants for the mosaic tiles — greens fading toward the surface,
// echoing the web .auth-tile gradients.
const TILE_TINTS = [0.22, 0.14, 0.3, 0.1, 0.18, 0.24];

function useLoop(duration: number, delay = 0) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return v;
}

function AuroraBlob({ color, size, top, left, right, dur, delay }: {
  color: string; size: number; top?: number; left?: number; right?: number; dur: number; delay: number;
}) {
  const v = useLoop(dur, delay);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, 26] });
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [0, right != null ? -22 : 22] });
  const opacity = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.6, 0.35] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left,
        right,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateX }, { translateY }],
      }}
    />
  );
}

function MosaicTile({ tint, primary, surface, delay }: { tint: number; primary: string; surface: string; delay: number }) {
  const v = useLoop(2600, delay);
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  return (
    <Animated.View
      style={{
        flex: 1,
        aspectRatio: 1,
        margin: 3,
        borderRadius: 8,
        backgroundColor: surface,
        opacity,
        transform: [{ scale }],
        overflow: 'hidden',
      }}>
      <View style={{ flex: 1, backgroundColor: primary, opacity: tint }} />
    </Animated.View>
  );
}

export function AuthHero() {
  const t = useTheme();
  const green = t.colors.primaryContainer;

  return (
    <View style={{ overflow: 'hidden', borderRadius: 24, marginBottom: t.spacing.xl }}>
      <View
        style={{
          backgroundColor: t.colors.surfaceContainer,
          paddingHorizontal: t.spacing.xl,
          paddingTop: t.spacing.xxl,
          paddingBottom: t.spacing.xl,
          overflow: 'hidden',
        }}>
        {/* Ambient aurora glows. */}
        <AuroraBlob color={green} size={220} top={-70} right={-50} dur={5200} delay={0} />
        <AuroraBlob color="#3a8f66" size={180} top={40} left={-60} dur={6400} delay={800} />

        {/* Brand mark + wordmark. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: t.spacing.xl }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: green,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialCommunityIcons name="image-multiple" size={22} color={t.colors.onPrimary} />
          </View>
          <Text variant="title" style={{ letterSpacing: 1 }}>
            nook
          </Text>
        </View>

        {/* Tagline. */}
        <Text variant="displayLarge" style={{ lineHeight: 38 }}>
          Your photos.{'\n'}Your server.{'\n'}
          <Text variant="displayLarge" color={green}>
            Nobody else&apos;s.
          </Text>
        </Text>

        {/* Drifting photo mosaic. */}
        <View style={{ flexDirection: 'row', marginTop: t.spacing.xl, marginHorizontal: -3, opacity: 0.9 }}>
          {TILE_TINTS.map((tint, i) => (
            <MosaicTile
              key={i}
              tint={tint}
              primary={green}
              surface={t.colors.surfaceContainerHigh ?? t.colors.surfaceVariant}
              delay={(i % 5) * 400}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
