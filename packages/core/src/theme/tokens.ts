/**
 * Material Design 3 color tokens for Nook Photos, extracted verbatim from the
 * Stitch design system (light + dark). Platform-agnostic hex values — the mobile
 * ThemeProvider and the web Tailwind config both consume these so the two apps
 * stay pixel-consistent.
 */

export interface ColorTokens {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  tertiary: string;
  error: string;
  onError: string;
  errorContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  /** Convenience aliases used across the UI. */
  overlay: string;
}

export const lightColors: ColorTokens = {
  primary: '#0058bc',
  onPrimary: '#ffffff',
  primaryContainer: '#0070eb',
  onPrimaryContainer: '#fefcff',
  secondary: '#4c4aca',
  onSecondary: '#ffffff',
  secondaryContainer: '#6664e4',
  tertiary: '#9e3d00',
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  background: '#faf9fe',
  onBackground: '#1a1b1f',
  surface: '#faf9fe',
  onSurface: '#1a1b1f',
  surfaceVariant: '#e3e2e7',
  onSurfaceVariant: '#414755',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f4f3f8',
  surfaceContainer: '#eeedf3',
  surfaceContainerHigh: '#e9e7ed',
  surfaceContainerHighest: '#e3e2e7',
  outline: '#717786',
  outlineVariant: '#c1c6d7',
  inverseSurface: '#2f3034',
  inverseOnSurface: '#f1f0f5',
  overlay: 'rgba(0,0,0,0.55)',
};

export const darkColors: ColorTokens = {
  primary: '#a6c8ff',
  onPrimary: '#003060',
  primaryContainer: '#004787',
  onPrimaryContainer: '#d4e3ff',
  secondary: '#bdc7dc',
  onSecondary: '#273141',
  secondaryContainer: '#3e4758',
  tertiary: '#dcbce1',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  background: '#111318',
  onBackground: '#e2e2e9',
  surface: '#111318',
  onSurface: '#e2e2e9',
  surfaceVariant: '#44474e',
  onSurfaceVariant: '#c4c6d0',
  surfaceContainerLowest: '#0c0e13',
  surfaceContainerLow: '#191c20',
  surfaceContainer: '#1d2024',
  surfaceContainerHigh: '#282a2f',
  surfaceContainerHighest: '#33353a',
  outline: '#8e9099',
  outlineVariant: '#44474e',
  inverseSurface: '#e2e2e9',
  inverseOnSurface: '#2e3036',
  overlay: 'rgba(0,0,0,0.7)',
};

/** Spacing scale (dp / px) — shared. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Corner radii — MD3-ish, matches the Stitch cards. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Type families. Loaded from Google Fonts on both platforms. */
export const fonts = {
  display: 'PlusJakartaSans',
  body: 'Inter',
} as const;

/** Type scale used across screens (size / lineHeight / weight). */
export const typeScale = {
  displayLarge: { size: 32, line: 40, weight: '700' },
  headline: { size: 24, line: 30, weight: '700' },
  title: { size: 20, line: 26, weight: '700' },
  titleSmall: { size: 16, line: 22, weight: '600' },
  body: { size: 15, line: 22, weight: '400' },
  label: { size: 13, line: 18, weight: '500' },
  caption: { size: 12, line: 16, weight: '400' },
} as const;

export type ThemeMode = 'light' | 'dark';

export const palettes: Record<ThemeMode, ColorTokens> = {
  light: lightColors,
  dark: darkColors,
};
