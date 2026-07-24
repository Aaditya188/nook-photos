/**
 * Album sharing — people grants (view/edit) + a guest share link (TTL, optional
 * password, download toggle). Mirrors the web ShareModal, using the same album
 * grant + share endpoints so links/grants are consistent across platforms.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ScrollView, Switch, Share, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNookClient, type AlbumGrant } from '@nook/core';
import { Text, Card, Button, TextField, Divider } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

type ShareInfo = { shared: boolean; url?: string; expiresAt?: number | null; hasPassword?: boolean; allowDownload?: boolean };

export default function AlbumShareScreen() {
  const t = useTheme();
  const client = useNookClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const serverUrl = useAuth((s) => s.serverUrl);

  const [grants, setGrants] = useState<AlbumGrant[] | null>(null);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [username, setUsername] = useState('');
  const [level, setLevel] = useState<'view' | 'edit'>('view');
  const [busy, setBusy] = useState(false);

  // Guest-link options
  const [expiresDays, setExpiresDays] = useState('30');
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);

  const load = useCallback(() => {
    if (!id) return;
    client.albumGrants(id).then((j) => setGrants(j.grants)).catch(() => setGrants([]));
    client.albumShare(id).then(setShare).catch(() => setShare({ shared: false }));
  }, [client, id]);
  useEffect(() => { load(); }, [load]);

  async function addGrant() {
    if (!id || !username.trim()) return;
    setBusy(true);
    try {
      const album = await client.addAlbumGrant(id, { username: username.trim(), level });
      setGrants(album.grants ?? []);
      setUsername('');
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }

  async function toggleLevel(g: AlbumGrant) {
    if (!id) return;
    const next = g.level === 'view' ? 'edit' : 'view';
    try {
      const album = await client.addAlbumGrant(id, { username: g.username, level: next });
      setGrants(album.grants ?? []);
    } catch { /* ignore */ }
  }

  async function removeGrant(g: AlbumGrant) {
    if (!id) return;
    try {
      const album = await client.removeAlbumGrant(id, g.userId);
      setGrants(album.grants ?? []);
    } catch { /* ignore */ }
  }

  const fullUrl = share?.url ? (serverUrl || client.baseUrl).replace(/\/+$/, '') + share.url : '';

  async function createLink() {
    if (!id) return;
    setBusy(true);
    try {
      await client.createAlbumShare(id, {
        expiresDays: expiresDays.trim() ? Number(expiresDays) : undefined,
        password: password.trim() || undefined,
        allowDownload,
      });
      setPassword('');
      load();
    } catch (e) {
      Alert.alert('Could not create link', e instanceof Error ? e.message : 'Failed');
    }
    setBusy(false);
  }

  async function revokeLink() {
    if (!id) return;
    try {
      await client.revokeAlbumShare(id);
      setShare({ shared: false });
    } catch { /* ignore */ }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title">Share album</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }}>
        {/* ---- People ---- */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>PEOPLE</Text>
          <Card style={{ gap: t.spacing.md }}>
            <TextField label="ADD BY USERNAME" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="username" />
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              {(['view', 'edit'] as const).map((lv) => (
                <Pressable
                  key={lv}
                  onPress={() => setLevel(lv)}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: t.radius.md,
                    backgroundColor: level === lv ? t.colors.primaryContainer : t.colors.surfaceContainerHigh,
                  }}>
                  <Text variant="label" color={level === lv ? t.colors.onPrimary : t.colors.onSurface}>
                    {lv === 'view' ? 'Can view' : 'Can edit'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button title="Add person" loading={busy} onPress={addGrant} />
          </Card>

          {grants === null ? (
            <ActivityIndicator color={t.colors.primaryContainer} />
          ) : grants.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {grants.map((g, i) => (
                <View key={g.userId}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="body">{g.displayName || g.username}</Text>
                      <Text variant="caption" color={t.colors.onSurfaceVariant}>@{g.username}</Text>
                    </View>
                    <Pressable onPress={() => toggleLevel(g)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceContainerHigh }}>
                      <Text variant="caption" color={t.colors.primaryContainer}>{g.level === 'edit' ? 'Can edit' : 'Can view'}</Text>
                    </Pressable>
                    <Pressable onPress={() => removeGrant(g)} hitSlop={8}>
                      <MaterialIcons name="remove-circle-outline" size={22} color={t.colors.error} />
                    </Pressable>
                  </View>
                  {i < grants.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </Card>
          ) : (
            <Text variant="caption" color={t.colors.onSurfaceVariant}>No one added yet.</Text>
          )}
        </View>

        {/* ---- Guest link ---- */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>GUEST LINK</Text>
          {share?.shared ? (
            <Card style={{ gap: t.spacing.md }}>
              <Text variant="caption" color={t.colors.onSurfaceVariant} selectable>{fullUrl}</Text>
              <Text variant="caption" color={t.colors.onSurfaceVariant}>
                {share.hasPassword ? 'Password protected · ' : ''}
                {share.allowDownload ? 'Downloads on' : 'Downloads off'}
                {share.expiresAt ? ` · expires ${new Date(share.expiresAt).toLocaleDateString()}` : ' · no expiry'}
              </Text>
              <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                <Button title="Send link" style={{ flex: 1 }} onPress={() => Share.share({ message: fullUrl, url: fullUrl })} />
                <Button title="Revoke" variant="ghost" style={{ flex: 1 }} onPress={revokeLink} />
              </View>
            </Card>
          ) : (
            <Card style={{ gap: t.spacing.md }}>
              <TextField label="EXPIRES IN (DAYS)" value={expiresDays} onChangeText={(v) => setExpiresDays(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" placeholder="30 — blank for never" />
              <TextField label="PASSWORD (OPTIONAL)" value={password} onChangeText={setPassword} placeholder="Leave blank for none" />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="body">Allow downloads</Text>
                <Switch value={allowDownload} onValueChange={setAllowDownload} trackColor={{ true: t.colors.primaryContainer }} />
              </View>
              <Button title="Create link" loading={busy} onPress={createLink} />
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
