import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { NookApiError, useUpdateAccount } from '@nook/core';
import { Screen, Text, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

export default function ChangePassword() {
  const t = useTheme();
  const update = useUpdateAccount();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (next.length < 6) return setError('New password must be at least 6 characters.');
    if (next !== confirm) return setError('Passwords do not match.');
    try {
      await update.mutateAsync({ currentPassword: current, newPassword: next });
      router.back();
    } catch (e) {
      setError(e instanceof NookApiError ? e.message : 'Could not change password');
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.xl }}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <Text variant="headline">Change Password</Text>
      <View style={{ gap: t.spacing.md }}>
        <TextField label="CURRENT PASSWORD" value={current} onChangeText={setCurrent} secureTextEntry />
        <TextField label="NEW PASSWORD" value={next} onChangeText={setNext} secureTextEntry />
        <TextField label="CONFIRM NEW PASSWORD" value={confirm} onChangeText={setConfirm} secureTextEntry />
        {error ? <Text variant="caption" color={t.colors.error}>{error}</Text> : null}
      </View>
      <View style={{ gap: t.spacing.md }}>
        <Button title="Update Password" loading={update.isPending} onPress={save} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
