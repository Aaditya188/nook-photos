/**
 * Small themed UI primitives shared across screens — Screen, Text, Button,
 * TextField, Card, ListRow. Styled from the @nook/core theme tokens.
 */
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/theme';

type Variant = keyof ReturnType<typeof useTheme>['typeScale'];

export function Text({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  const t = useTheme();
  const s = t.typeScale[variant];
  return (
    <RNText
      {...rest}
      style={[
        { fontSize: s.size, lineHeight: s.line, fontWeight: s.weight as any, color: color ?? t.colors.onSurface },
        style,
      ]}
    />
  );
}

export function Screen({
  children,
  edges = ['top'],
  scroll = false,
  padded = true,
  style,
  contentStyle,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  padded?: boolean;
  style?: ViewProps['style'];
  contentStyle?: ViewProps['style'];
}) {
  const t = useTheme();
  const pad = padded ? { paddingHorizontal: t.spacing.lg } : null;
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: t.colors.background }, style]}>
      <Body
        {...(scroll
          ? { contentContainerStyle: [pad, contentStyle], showsVerticalScrollIndicator: false }
          : { style: [{ flex: 1 }, pad, contentStyle] })}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  style,
  ...rest
}: PressableProps & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'tonal' | 'ghost';
}) {
  const t = useTheme();
  const bg =
    variant === 'primary'
      ? t.colors.primaryContainer
      : variant === 'tonal'
        ? t.colors.surfaceContainerHigh
        : 'transparent';
  const fg = variant === 'primary' ? t.colors.onPrimary : t.colors.onSurface;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={isDisabled}
      style={(state) => [
        {
          height: 50,
          borderRadius: 14,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          opacity: isDisabled ? 0.5 : (state as any).pressed ? 0.9 : 1,
        },
        style as any,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <RNText style={{ color: fg, fontSize: 15.5, fontWeight: '700', letterSpacing: 0.1 }}>{title}</RNText>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  style,
  ...rest
}: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.colors.outline}
        {...rest}
        style={[
          {
            height: 52,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.surfaceContainer,
            paddingHorizontal: t.spacing.lg,
            color: t.colors.onSurface,
            fontSize: 16,
            borderWidth: 1,
            borderColor: t.colors.outlineVariant,
          },
          style,
        ]}
      />
    </View>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.colors.surfaceContainerLow,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
        },
        style,
      ]}
    />
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.colors.outlineVariant, opacity: 0.5 }} />;
}

/**
 * Canonical detail-screen header: optional back chevron, title, optional right
 * action, and an optional subtitle aligned under the title. Keeps every screen's
 * top bar spaced identically (the mobile echo of the web ViewHead).
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  back = true,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: boolean;
  onBack?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: t.spacing.md, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        {back ? (
          <Pressable onPress={onBack ?? (() => router.back())} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
          </Pressable>
        ) : null}
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? (
        <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ marginLeft: back ? 34 : 0 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Branded loader: the nook mark on its green tile with a spinner beneath and an
 * optional label — the mobile echo of the web boot loader. `full` fills and
 * centres the screen.
 */
/**
 * The Nook loading mark — mirrors the web BootLoader: a green glyph tile with
 * two counter-rotating arc rings and the "nook" wordmark beneath. Used for the
 * boot splash (full) and inline (full={false}) wherever heavy fetches happen.
 */
export function BrandLoader({ label, full = true }: { label?: string; full?: boolean }) {
  const t = useTheme();
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateBack = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  const inner = (
    <View style={{ alignItems: 'center', gap: 18 }}>
      <View style={{ width: 78, height: 78, alignItems: 'center', justifyContent: 'center' }}>
        {/* Outer arc — one visible edge, spinning forward. */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 78,
            height: 78,
            borderRadius: 39,
            borderWidth: 2.5,
            borderColor: 'transparent',
            borderTopColor: t.colors.primaryContainer,
            transform: [{ rotate }],
          }}
        />
        {/* Inner arc — counter-rotating, dimmer. */}
        <Animated.View
          style={{
            position: 'absolute',
            width: 64,
            height: 64,
            borderRadius: 32,
            borderWidth: 2,
            borderColor: 'transparent',
            borderTopColor: t.colors.primaryContainer,
            opacity: 0.4,
            transform: [{ rotate: rotateBack }],
          }}
        />
        {/* Green brand tile with the photo glyph. */}
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            backgroundColor: t.colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialCommunityIcons name="image-multiple" size={24} color={t.colors.onPrimary} />
        </View>
      </View>
      <Text variant="title" color={t.colors.onSurface} style={{ letterSpacing: 1 }}>
        nook
      </Text>
      {label ? (
        <Text variant="caption" color={t.colors.onSurfaceVariant}>
          {label}
        </Text>
      ) : null}
    </View>
  );
  if (!full) return inner;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
      {inner}
    </View>
  );
}
