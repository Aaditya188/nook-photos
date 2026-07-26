import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { NookApiError, useAccount, useUpdateAccount, useNookClient } from '@nook/core';
import { Screen, Text, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme';

export default function EditProfile() {
  const t = useTheme();
  const client = useNookClient();
  const account = useAccount();
  const update = useUpdateAccount();
  const [displayName, setDisplayName] = useState(account.data?.displayName ?? '');
  const [email, setEmail] = useState(account.data?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ displayName: displayName.trim(), email: email.trim() || undefined });
      router.back();
    } catch (e) {
      setError(e instanceof NookApiError ? e.message : 'Could not save');
    }
  }

  async function changeAvatar() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo access is needed to pick a profile photo.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setAvatarBusy(true);
    try {
      // Downscale to a compact square JPEG before upload.
      const out = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 512 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      const res = await FileSystem.uploadAsync(client.url('/api/account/avatar'), out.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { ...client.authHeaders(), 'Content-Type': 'image/jpeg' },
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      await account.refetch();
    } catch {
      setError('Could not upload the photo.');
    }
    setAvatarBusy(false);
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      await client.removeAvatar();
      await account.refetch();
    } catch {
      setError('Could not remove the photo.');
    }
    setAvatarBusy(false);
  }

  const avatarUrl = account.data?.avatarUrl;
  const initials = (account.data?.displayName || account.data?.username || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.xl }}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />
      <Text variant="headline">Edit Profile</Text>

      {/* Profile photo */}
      <View style={{ alignItems: 'center', gap: t.spacing.md }}>
        <Pressable onPress={changeAvatar} disabled={avatarBusy}>
          <View
            style={{
              width: 104,
              height: 104,
              borderRadius: 52,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.colors.surfaceContainerHigh,
              opacity: avatarBusy ? 0.5 : 1,
            }}
          >
            {avatarUrl ? (
              <Image
                source={{ uri: client.url(avatarUrl), headers: client.authHeaders() }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Text variant="headline" color={t.colors.onSurfaceVariant}>{initials}</Text>
            )}
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <Button title={avatarUrl ? 'Change photo' : 'Upload photo'} variant="tonal" loading={avatarBusy} onPress={changeAvatar} />
          {avatarUrl ? <Button title="Remove" variant="ghost" onPress={removeAvatar} disabled={avatarBusy} /> : null}
        </View>
      </View>

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
