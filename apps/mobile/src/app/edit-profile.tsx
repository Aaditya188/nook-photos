import { useState } from 'react';
import { View } from 'react-native';
import { router, Stack } from 'expo-router';
import { NookApiError, useAccount, useUpdateAccount } from '@nook/core';
import { Screen, Text, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

export default function EditProfile() {
  const t = useTheme();
  const account = useAccount();
  const update = useUpdateAccount();
  const [displayName, setDisplayName] = useState(account.data?.displayName ?? '');
  const [email, setEmail] = useState(account.data?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ displayName: displayName.trim(), email: email.trim() || undefined });
      router.back();
    } catch (e) {
      setError(e instanceof NookApiError ? e.message : 'Could not save');
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.xl }}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <Text variant="headline">Edit Profile</Text>
      <View style={{ gap: t.spacing.md }}>
        <TextField label="DISPLAY NAME" value={displayName} onChangeText={setDisplayName} />
        <TextField label="EMAIL" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        {error ? <Text variant="caption" color={t.colors.error}>{error}</Text> : null}
      </View>
      <View style={{ gap: t.spacing.md }}>
        <Button title="Save" loading={update.isPending} onPress={save} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
