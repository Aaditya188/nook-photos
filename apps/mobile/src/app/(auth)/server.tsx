import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NookApiError } from '@nook/core';
import { Screen, Text, Button, TextField, Card } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

type Probe =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; setupRequired: boolean; name?: string }
  | { state: 'error'; message: string };

export default function ServerConfigScreen() {
  const t = useTheme();
  const existing = useAuth((s) => s.serverUrl);
  const setServerUrl = useAuth((s) => s.setServerUrl);
  const testConnection = useAuth((s) => s.testConnection);

  const [url, setUrl] = useState(existing ?? '');
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });

  async function onTest() {
    setProbe({ state: 'testing' });
    try {
      const res = await testConnection(url);
      setProbe({ state: 'ok', setupRequired: res.setupRequired, name: (res as any).server });
    } catch (e) {
      const message =
        e instanceof NookApiError ? e.message : e instanceof Error ? e.message : 'Could not reach server';
      setProbe({ state: 'error', message });
    }
  }

  async function onContinue() {
    if (probe.state !== 'ok') return;
    await setServerUrl(url);
    router.push({ pathname: '/(auth)/login', params: { setup: probe.setupRequired ? '1' : '0' } });
  }

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.xxl, gap: t.spacing.xl }}>
      <View style={{ gap: t.spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialCommunityIcons name="cloud-lock-outline" size={30} color={t.colors.onPrimary} />
        </View>
        <Text variant="displayLarge">Nook Photos</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant}>
          Connect to your Nook server to back up and browse your photos.
        </Text>
      </View>

      <View style={{ gap: t.spacing.md }}>
        <TextField
          label="SERVER URL"
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setProbe({ state: 'idle' });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://nook.example.com"
        />

        {probe.state === 'ok' ? (
          <Card style={{ backgroundColor: t.colors.surfaceContainer, flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
            <MaterialCommunityIcons name="check-circle" size={22} color={t.colors.primaryContainer} />
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall">Connected</Text>
              <Text variant="caption" color={t.colors.onSurfaceVariant}>
                {probe.setupRequired ? 'New server — create the first (admin) account.' : 'Ready to sign in.'}
              </Text>
            </View>
          </Card>
        ) : null}

        {probe.state === 'error' ? (
          <Card style={{ backgroundColor: t.colors.errorContainer, flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
            <MaterialCommunityIcons name="alert-circle" size={22} color={t.colors.error} />
            <Text variant="caption" color={t.colors.onSurface} style={{ flex: 1 }}>
              {probe.message}
            </Text>
          </Card>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.md }}>
        {probe.state === 'ok' ? (
          <Button title="Continue" onPress={onContinue} />
        ) : (
          <Button
            title="Test Connection"
            variant="primary"
            loading={probe.state === 'testing'}
            onPress={onTest}
          />
        )}
      </View>
    </Screen>
  );
}
