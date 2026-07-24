/**
 * Security — two-factor authentication. Mirrors web Settings › Security: show
 * TOTP status, enable (manual key + verify 6-digit code) or disable (code).
 * Uses the account's totpEnabled flag and the client's totp endpoints.
 */
import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNookClient, useAccount } from '@nook/core';
import { Text, Card, Button, TextField, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/theme';

export default function SecurityScreen() {
  const t = useTheme();
  const client = useNookClient();
  const account = useAccount();
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<'idle' | 'setup'>('idle');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account.data) setOn(!!account.data.totpEnabled);
  }, [account.data]);

  async function startSetup() {
    setError(null);
    setMode('setup');
    try {
      const j = await client.totpSetup();
      setSecret(j.secret);
    } catch {
      setError('Could not start setup');
      setMode('idle');
    }
  }

  async function verify() {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await client.totpVerify(code);
      setOn(true);
      setMode('idle');
      setCode('');
      account.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    }
    setBusy(false);
  }

  async function disable() {
    if (code.length !== 6) {
      setError('Enter your current 6-digit code to disable.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.totpDisable(code);
      setOn(false);
      setCode('');
      account.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disable');
    }
    setBusy(false);
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Security" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Card style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <MaterialIcons name={on ? 'verified-user' : 'security'} size={22} color={on ? t.colors.primaryContainer : t.colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text variant="body">Two-factor authentication</Text>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>
              {on ? 'On — a code is required at sign-in.' : 'Add a second step to every sign-in.'}
            </Text>
          </View>
        </View>

        {mode === 'setup' && !on ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>
              Add this key to your authenticator app, then enter the 6-digit code.
            </Text>
            {secret ? (
              <View style={{ backgroundColor: t.colors.surfaceContainerHigh, padding: t.spacing.md, borderRadius: t.radius.md }}>
                <Text variant="body" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{secret}</Text>
              </View>
            ) : <Text variant="caption" color={t.colors.onSurfaceVariant}>Generating…</Text>}
            <TextField label="6-DIGIT CODE" value={code} onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
            {error ? <Text variant="caption" color={t.colors.error}>{error}</Text> : null}
            <Button title="Turn on" loading={busy} disabled={code.length !== 6} onPress={verify} />
          </View>
        ) : on ? (
          <View style={{ gap: t.spacing.sm }}>
            <TextField label="CURRENT CODE" value={code} onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" />
            {error ? <Text variant="caption" color={t.colors.error}>{error}</Text> : null}
            <Button title="Disable two-factor" variant="tonal" loading={busy} onPress={disable} />
          </View>
        ) : (
          <Button title="Enable" onPress={startSetup} />
        )}
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Pressable onPress={() => router.push('/devices')} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
          <MaterialIcons name="devices" size={22} color={t.colors.onSurfaceVariant} />
          <Text variant="body" style={{ flex: 1 }}>Signed-in devices</Text>
          <MaterialIcons name="chevron-right" size={22} color={t.colors.outline} />
        </Pressable>
      </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
