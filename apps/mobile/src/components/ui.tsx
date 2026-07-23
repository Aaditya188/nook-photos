/**
 * Small themed UI primitives shared across screens — Screen, Text, Button,
 * TextField, Card, ListRow. Styled from the @nook/core theme tokens.
 */
import React from 'react';
import {
  ActivityIndicator,
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
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
 * Branded loader: the nook mark on its green tile with a spinner beneath and an
 * optional label — the mobile echo of the web boot loader. `full` fills and
 * centres the screen.
 */
export function BrandLoader({ label, full = true }: { label?: string; full?: boolean }) {
  const t = useTheme();
  const inner = (
    <View style={{ alignItems: 'center', gap: 16 }}>
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 18,
          backgroundColor: t.colors.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <MaterialCommunityIcons name="image-multiple" size={30} color={t.colors.onPrimary} />
      </View>
      <ActivityIndicator color={t.colors.primaryContainer} />
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
