/**
 * Admin — user management. Mirrors the web Settings › Users section: list
 * accounts, add a user (name / username / password), delete non-self users.
 */
import { useState } from 'react';
import { View, Pressable, Alert } from 'react-native';
import { router, Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useUsers, useCreateUser, useDeleteUser, NookApiError } from '@nook/core';
import { Screen, Text, Card, Button, TextField, Divider } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function UsersScreen() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const users = useUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    if (!name.trim() || !username.trim() || !password) {
      setError('All fields are required.');
      return;
    }
    try {
      await createUser.mutateAsync({ displayName: name.trim(), username: username.trim(), password });
      setAdding(false);
      setName('');
      setUsername('');
      setPassword('');
    } catch (e) {
      setError(e instanceof NookApiError ? e.message : e instanceof Error ? e.message : 'Could not create user');
    }
  }

  function onDelete(id: string, label: string) {
    Alert.alert('Delete ' + label + '?', 'Their photos and albums are removed from the server. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteUser.mutateAsync(id).catch(() => {}) },
    ]);
  }

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.sm, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title" style={{ flex: 1 }}>Users</Text>
        {!adding ? <Button title="Add" onPress={() => setAdding(true)} /> : null}
      </View>

      {adding ? (
        <Card style={{ gap: t.spacing.md }}>
          <Text variant="titleSmall">Add user</Text>
          <TextField label="NAME" value={name} onChangeText={setName} placeholder="Full name" />
          <TextField label="USERNAME" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="username" />
          <TextField label="PASSWORD" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" />
          {error ? <Text variant="caption" color={t.colors.error}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => { setAdding(false); setError(null); }} />
            <Button title="Create" style={{ flex: 1 }} loading={createUser.isPending} onPress={onCreate} />
          </View>
        </Card>
      ) : null}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(users.data ?? []).map((u, i, arr) => (
          <View key={u.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
              <View style={{ flex: 1 }}>
                <Text variant="body">{u.displayName || u.username}</Text>
                <Text variant="caption" color={t.colors.onSurfaceVariant}>
                  @{u.username}{u.role === 'admin' ? ' · admin' : ''}
                </Text>
              </View>
              {me && u.id !== me.id ? (
                <Pressable onPress={() => onDelete(u.id, u.displayName || u.username)} hitSlop={8}>
                  <MaterialIcons name="delete-outline" size={22} color={t.colors.error} />
                </Pressable>
              ) : (
                <Text variant="caption" color={t.colors.onSurfaceVariant}>you</Text>
              )}
            </View>
            {i < arr.length - 1 ? <Divider /> : null}
          </View>
        ))}
        {users.isLoading ? <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ padding: t.spacing.lg }}>Loading…</Text> : null}
      </Card>
    </Screen>
  );
}
