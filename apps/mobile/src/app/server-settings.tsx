/**
 * Admin — server settings. Mirrors web Settings › Server: shows storage usage
 * and lets an admin set the server name, max storage (GB), and public URL.
 */
import { useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNookClient, useStatus, humanBytes } from '@nook/core';
import { Text, Card, Button, TextField, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/theme';

const GB = 1024 * 1024 * 1024;

type Settings = {
  serverName: string;
  storageTotalBytes: number;
  detectedTotalBytes: number;
  availableBytes: number | null;
  publicUrl: string;
};

export default function ServerSettingsScreen() {
  const t = useTheme();
  const client = useNookClient();
  const status = useStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState('');
  const [allocGb, setAllocGb] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.serverSettings().then((j) => {
      setSettings(j);
      setName(j.serverName);
      setAllocGb(j.storageTotalBytes ? String(Math.round(j.storageTotalBytes / GB)) : '');
      setUrl(j.publicUrl);
    }).catch(() => {});
  }, [client]);

  const st = status.data?.storage;
  const pct = st && st.totalBytes > 0 ? Math.min(100, (st.usedBytes / st.totalBytes) * 100) : 0;

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const updated = await client.updateServerSettings({
        serverName: name.trim(),
        storageTotalBytes: allocGb.trim() ? Number(allocGb) * GB : 0,
        publicUrl: url.trim(),
      });
      setSettings(updated);
      setSaved(true);
      status.refetch();
    } catch {
      /* ignore */
    }
    setBusy(false);
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Server" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Card style={{ gap: t.spacing.sm }}>
        <Text variant="titleSmall">{status.data?.server?.name || 'nook.local'}</Text>
        {status.data?.server?.version ? (
          <Text variant="caption" color={t.colors.onSurfaceVariant}>Version {status.data.server.version}</Text>
        ) : null}
        {st ? (
          <>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceContainerHigh, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: t.colors.primaryContainer }} />
            </View>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>
              {humanBytes(st.usedBytes)} used of {humanBytes(st.totalBytes)} allocated
              {st.availableBytes != null ? ` · ${humanBytes(st.availableBytes)} free on disk` : ''}
            </Text>
          </>
        ) : null}
      </Card>

      <View style={{ gap: t.spacing.md }}>
        <TextField label="SERVER NAME" value={name} onChangeText={setName} placeholder="nook.local" />
        <TextField
          label="MAX STORAGE (GB)"
          value={allocGb}
          onChangeText={(v) => setAllocGb(v.replace(/[^\d]/g, ''))}
          keyboardType="number-pad"
          placeholder={settings ? `Auto — ${Math.round(settings.detectedTotalBytes / GB)} GB detected` : 'Auto'}
        />
        {settings?.availableBytes != null ? (
          <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ marginTop: -8 }}>
            {humanBytes(settings.availableBytes)} free on the data disk right now.
          </Text>
        ) : null}
        <TextField label="PUBLIC URL" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://photos.example.com" />
        <Text variant="caption" color={t.colors.onSurfaceVariant} style={{ marginTop: -8 }}>
          Used for share links and mobile setup. It does not create a tunnel.
        </Text>
      </View>

      <Button title={saved ? 'Saved' : 'Save server settings'} loading={busy} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
