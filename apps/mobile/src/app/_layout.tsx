import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

function Root() {
  const hydrateAuth = useAuth((s) => s.hydrate);
  const hydrateSettings = useSettings((s) => s.hydrate);
  const status = useAuth((s) => s.status);
  const settingsHydrated = useSettings((s) => s.hydrated);
  const t = useTheme();

  useEffect(() => {
    void hydrateAuth();
    void hydrateSettings();
  }, [hydrateAuth, hydrateSettings]);

  useEffect(() => {
    if (status !== 'loading' && settingsHydrated) {
      void SplashScreen.hideAsync();
    }
  }, [status, settingsHydrated]);

  return (
    <>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <Root />
    </AppProviders>
  );
}
