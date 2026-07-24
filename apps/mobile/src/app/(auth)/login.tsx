import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { NookApiError } from '@nook/core';
import { Screen, Text, Button, TextField } from '@/components/ui';
import { AuthHero } from '@/components/AuthHero';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function LoginScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ setup?: string }>();
  const serverUrl = useAuth((s) => s.serverUrl);
  const login = useAuth((s) => s.login);
  const setup = useAuth((s) => s.setup);

  const [isSetup, setIsSetup] = useState(params.setup === '1');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      if (isSetup) {
        await setup({ username: username.trim(), password, displayName: displayName.trim() || username.trim(), email: email.trim() || undefined });
        // First account just became the admin — show the onboarding guide.
        router.replace('/welcome');
        return;
      }
      await login(username.trim(), password);
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof NookApiError ? e.message : e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  const host = serverUrl?.replace(/^https?:\/\//, '') ?? '';

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.xl }}>
      <AuthHero />

      <View style={{ gap: t.spacing.xs }}>
        <Text variant="headline">{isSetup ? 'Create your account' : 'Welcome back'}</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant}>
          {isSetup ? 'The first account becomes the admin.' : 'Sign in to ' + host}
        </Text>
      </View>

      <View style={{ gap: t.spacing.md }}>
        <TextField label="USERNAME" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="username" />
        {isSetup ? (
          <>
            <TextField label="DISPLAY NAME" value={displayName} onChangeText={setDisplayName} placeholder="Your name" />
            <TextField label="EMAIL (OPTIONAL)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
          </>
        ) : null}
        <TextField label="PASSWORD" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />

        {error ? (
          <Text variant="caption" color={t.colors.error}>
            {error}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.md }}>
        <Button title={isSetup ? 'Create account' : 'Sign In'} loading={busy} onPress={onSubmit} />
        <Pressable onPress={() => router.back()} style={{ alignItems: 'center', paddingVertical: t.spacing.sm }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>
            Change server ({host})
          </Text>
        </Pressable>
        {!params.setup ? (
          <Pressable onPress={() => setIsSetup((v) => !v)} style={{ alignItems: 'center' }}>
            <Text variant="label" color={t.colors.primaryContainer}>
              {isSetup ? 'I already have an account' : 'Set up a new server'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}
