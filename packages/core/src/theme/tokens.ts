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

// Palettes mirror the web app's design tokens (apps/web/src/styles.css): a
// green accent (primaryContainer) on near-black surfaces, so mobile and web
// share one visual language. primaryContainer = the accent fill; onPrimary /
// onPrimaryContainer = the dark ink used on it.
export const lightColors: ColorTokens = {
  primary: '#12995a',
  onPrimary: '#ffffff',
  primaryContainer: '#12995a',
  onPrimaryContainer: '#ffffff',
  secondary: '#2f6bd6',
  onSecondary: '#ffffff',
  secondaryContainer: '#e7e7ec',
  tertiary: '#a86f1a',
  error: '#d63b62',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  background: '#f4f4f7',
  onBackground: 'rgba(17,17,22,0.95)',
  surface: '#f4f4f7',
  onSurface: 'rgba(17,17,22,0.95)',
  surfaceVariant: '#eeeef2',
  onSurfaceVariant: 'rgba(17,17,22,0.54)',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eaeaef',
  surfaceContainer: '#f1f1f5',
  surfaceContainerHigh: '#e7e7ec',
  surfaceContainerHighest: '#dedee4',
  outline: 'rgba(0,0,0,0.2)',
  outlineVariant: 'rgba(0,0,0,0.1)',
  inverseSurface: '#1a1b1f',
  inverseOnSurface: '#f1f0f5',
  overlay: 'rgba(0,0,0,0.55)',
};

export const darkColors: ColorTokens = {
  primary: '#57d38a',
  onPrimary: '#06140c',
  primaryContainer: '#57d38a',
  onPrimaryContainer: '#06140c',
  secondary: '#8fb7ff',
  onSecondary: '#06140c',
  secondaryContainer: '#202022',
  tertiary: '#f0b35e',
  error: '#ff6b8a',
  onError: '#2a0710',
  errorContainer: '#3a1119',
  background: '#0b0b0c',
  onBackground: 'rgba(235,235,245,0.96)',
  surface: '#0b0b0c',
  onSurface: 'rgba(235,235,245,0.96)',
  surfaceVariant: '#17171a',
  onSurfaceVariant: 'rgba(235,235,245,0.6)',
  surfaceContainerLowest: '#0e0f10',
  surfaceContainerLow: '#121412',
  surfaceContainer: '#161618',
  surfaceContainerHigh: '#1a1a1c',
  surfaceContainerHighest: '#202022',
  outline: 'rgba(255,255,255,0.14)',
  outlineVariant: 'rgba(255,255,255,0.07)',
  inverseSurface: '#ebebf5',
  inverseOnSurface: '#111114',
  overlay: 'rgba(0,0,0,0.72)',
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
