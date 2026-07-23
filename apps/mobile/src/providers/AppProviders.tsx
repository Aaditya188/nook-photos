/**
 * Root providers: React Query, the shared NookClient (derived from the auth
 * store), the theme, and the gesture/safe-area roots. Mounted once at the app root.
 */
import React, { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NookClient, NookClientProvider } from '@nook/core';
import { useAuth } from '@/store/auth';
import { ThemeProvider } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const serverUrl = useAuth((s) => s.serverUrl);
  const token = useAuth((s) => s.token);

  // Rebuild the client whenever the server or token changes.
  const client = useMemo(
    () => new NookClient({ baseUrl: serverUrl ?? 'https://nook.invalid', token }),
    [serverUrl, token],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <NookClientProvider client={client}>
            <ThemeProvider>{children}</ThemeProvider>
          </NookClientProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
