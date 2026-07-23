import { useState } from 'react';
import { View, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NookApiError, useUsers, useCreateUser, useDeleteUser, type User } from '@nook/core';
import { Text, Card, Button, TextField, Divider } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function SharingScreen() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const users = useUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const [adding, setAdding] = useState(false);

  const isAdmin = me?.role === 'admin';

  if (!isAdmin) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
        <View style={{ padding: t.spacing.lg }}>
          <Text variant="headline">Sharing</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm, padding: 24 }}>
          <MaterialIcons name="group" size={44} color={t.colors.outline} />
          <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            Only an admin can manage users on this server.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  function remove(u: User) {
    Alert.alert('Remove user?', `Delete ${u.displayName || u.username} and all their photos?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteUser.mutate(u.id) },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }}>
        <Text variant="headline">Sharing</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant} style={{ marginTop: -12 }}>
          Manage who has access to this Nook server.
        </Text>

        {adding ? (
          <AddUserForm
            busy={createUser.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              try {
                await createUser.mutateAsync(input);
                setAdding(false);
              } catch (e) {
                Alert.alert('Could not add user', e instanceof NookApiError ? e.message : 'Failed');
              }
            }}
          />
        ) : (
          <Button title="Add User" onPress={() => setAdding(true)} />
        )}

        <View style={{ gap: t.spacing.md }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>PEOPLE WITH ACCESS</Text>
          {users.isLoading ? (
            <ActivityIndicator color={t.colors.primaryContainer} />
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {(users.data ?? []).map((u, i) => (
                <View key={u.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.secondaryContainer, alignItems: 'center', justifyContent: 'center' }}>
                      <Text color={t.colors.onSecondary}>{(u.displayName || u.username).slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body">{u.displayName || u.username}{u.id === me?.id ? ' (you)' : ''}</Text>
                      <Text variant="caption" color={t.colors.onSurfaceVariant}>{u.role === 'admin' ? 'Admin' : 'Member'} · @{u.username}</Text>
                    </View>
                    {u.id !== me?.id ? (
                      <Pressable onPress={() => remove(u)} hitSlop={8}>
                        <MaterialIcons name="remove-circle-outline" size={22} color={t.colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  {i < (users.data ?? []).length - 1 ? <Divider /> : null}
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AddUserForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (input: { username: string; password: string; displayName: string; email?: string }) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Card style={{ gap: t.spacing.md }}>
      <Text variant="titleSmall">New user</Text>
      <TextField label="USERNAME" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextField label="DISPLAY NAME" value={displayName} onChangeText={setDisplayName} />
      <TextField label="PASSWORD" value={password} onChangeText={setPassword} secureTextEntry />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={onCancel} />
        <Button
          title="Add"
          loading={busy}
          style={{ flex: 1 }}
          onPress={() => onSubmit({ username: username.trim(), password, displayName: displayName.trim() || username.trim() })}
        />
      </View>
    </Card>
  );
}
