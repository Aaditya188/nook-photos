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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const preference = useSettings((s) => s.themeMode);
  const mode: ThemeMode =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<Theme>(
    () => ({ mode, colors: palettes[mode], spacing, radius, typeScale, fonts }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used within <ThemeProvider>');
  return t;
}
