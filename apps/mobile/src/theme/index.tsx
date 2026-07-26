/**
 * App theme: exposes the shared @nook/core MD3 tokens as a React context, honoring
 * the user's mode preference (light / dark / system).
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  palettes,
  spacing,
  radius,
  typeScale,
  fonts,
  type ColorTokens,
  type ThemeMode,
} from '@nook/core';
import { useSettings } from '@/store/settings';

export interface Theme {
  mode: ThemeMode;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  typeScale: typeof typeScale;
  fonts: typeof fonts;
}

const ThemeContext = createContext<Theme | null>(null);

/** Readable text color (near-black or white) for a given accent background. */
function foregroundFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#06140c';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceived luminance; light accents get dark text, dark accents get white.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#06140c' : '#ffffff';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const preference = useSettings((s) => s.themeMode);
  const accent = useSettings((s) => s.prefs.accent);
  const mode: ThemeMode =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<Theme>(() => {
    const base = palettes[mode];
    const colors: ColorTokens = accent
      ? { ...base, primaryContainer: accent, primary: accent, onPrimary: foregroundFor(accent) }
      : base;
    return { mode, colors, spacing, radius, typeScale, fonts };
  }, [mode, accent]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used within <ThemeProvider>');
  return t;
}
