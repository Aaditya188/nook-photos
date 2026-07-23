/**
 * React context that exposes the configured NookClient to data hooks. Each app
 * (mobile/web) constructs the client from its own stored serverUrl + token and
 * mounts this provider under a QueryClientProvider.
 */
import React, { createContext, useContext } from 'react';
import { NookClient } from '../api/client';

const NookClientContext = createContext<NookClient | null>(null);

export function NookClientProvider({
  client,
  children,
}: {
  client: NookClient;
  children: React.ReactNode;
}) {
  return <NookClientContext.Provider value={client}>{children}</NookClientContext.Provider>;
}

export function useNookClient(): NookClient {
  const client = useContext(NookClientContext);
  if (!client) {
    throw new Error('useNookClient must be used within a <NookClientProvider>');
  }
  return client;
}
