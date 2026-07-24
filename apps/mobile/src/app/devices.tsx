/**
 * Security — signed-in devices. Mirrors web Settings › Devices: list active
 * sessions and revoke them (revoking the current one signs out).
 */
import { useEffect, useState, useCallback } from 'react';
import { View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNookClient } from '@nook/core';
import { Text, Card, Divider, Button, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

type Session = { id: string; createdAt: string; label: string; current: boolean };

export default function DevicesScreen() {
  const t = useTheme();
  const client = useNookClient();
  const logout = useAuth((s) => s.logout);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const reload = useCallback(() => {
    client.sessions().then((j) => setSessions(j.sessions)).catch(() => setSessions([]));
  }, [client]);
  useEffect(() => { reload(); }, [reload]);

  async function revoke(s: Session) {
    try {
      await client.revokeSession(s.id);
      if (s.current) return logout();
      reload();
    } catch {
      /* ignore */
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Signed-in devices" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {sessions === null ? (
          <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ padding: t.spacing.lg }}>Loading…</Text>
        ) : sessions.length === 0 ? (
          <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ padding: t.spacing.lg }}>No active sessions.</Text>
        ) : (
          sessions.map((s, i, arr) => (
            <View key={s.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{s.label}{s.current ? ' · this device' : ''}</Text>
                  <Text variant="caption" color={t.colors.onSurfaceVariant}>
                    since {new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
                <Button title={s.current ? 'Sign out' : 'Revoke'} variant="ghost" onPress={() => revoke(s)} />
              </View>
              {i < arr.length - 1 ? <Divider /> : null}
            </View>
          ))
        )}
      </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
