import { View, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNookClient } from '@nook/core';
import { Text, Card, Button, Divider } from '@/components/ui';
import { useSync } from '@/store/sync';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function BackupScreen() {
  const t = useTheme();
  const client = useNookClient();
  const phase = useSync((s) => s.phase);
  const running = useSync((s) => s.running);
  const start = useSync((s) => s.start);
  const cancel = useSync((s) => s.cancel);
  const backup = useSettings((s) => s.backup);
  const setBackupPref = useSettings((s) => s.setBackupPref);
  const serverUrl = useAuth((s) => s.serverUrl);

  const progress =
    phase.state === 'uploading' && phase.total > 0 ? phase.done / phase.total : phase.state === 'done' ? 1 : 0;

  const statusLine =
    phase.state === 'uploading'
      ? `Backing up ${phase.done} of ${phase.total}…`
      : phase.state === 'scanning'
        ? 'Scanning your library…'
        : phase.state === 'permission'
          ? 'Requesting photo access…'
          : phase.state === 'permission-denied'
            ? 'Photo access denied — enable it in Settings.'
            : phase.state === 'done'
              ? `Backed up ${phase.uploaded} item${phase.uploaded === 1 ? '' : 's'}${phase.failed ? `, ${phase.failed} failed` : ''}`
              : phase.state === 'error'
                ? phase.message
                : 'Up to date';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title">Backup &amp; Server</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.xxl }}>
        {/* Progress card */}
        <Card style={{ gap: t.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.primaryContainer, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name={phase.state === 'done' ? 'cloud-check' : 'cloud-upload'} size={24} color={t.colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall">{running ? 'Backing up…' : phase.state === 'done' ? 'Backup complete' : 'Ready to back up'}</Text>
              <Text variant="caption" color={phase.state === 'error' || phase.state === 'permission-denied' ? t.colors.error : t.colors.onSurfaceVariant}>
                {statusLine}
              </Text>
            </View>
          </View>

          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceContainerHighest, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${Math.round(progress * 100)}%`, backgroundColor: t.colors.primaryContainer }} />
          </View>

          {running ? (
            <Button title="Pause" variant="tonal" onPress={cancel} />
          ) : (
            <Button title="Back Up Now" onPress={() => start(client, { wifiOnly: backup.wifiOnly, originalQuality: backup.originalQuality })} />
          )}
        </Card>

        {/* Preferences */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>PREFERENCES</Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <ToggleRow icon="wifi" label="Sync over Wi-Fi only" sub="Uses less mobile data" value={backup.wifiOnly} onChange={(v) => setBackupPref('wifiOnly', v)} />
            <Divider />
            <ToggleRow icon="high-quality" label="Upload original quality" sub="Uses more server storage" value={backup.originalQuality} onChange={(v) => setBackupPref('originalQuality', v)} />
            <Divider />
            <ToggleRow icon="delete-sweep" label="Delete from phone after backup" sub="Frees up local storage" value={backup.deleteAfterBackup} onChange={(v) => setBackupPref('deleteAfterBackup', v)} />
            <Divider />
            <ToggleRow icon="sync" label="Background backup" sub="Requires a full build (not Expo Go)" value={backup.backgroundBackup} onChange={(v) => setBackupPref('backgroundBackup', v)} />
          </Card>
        </View>

        {/* Server config */}
        <View style={{ gap: t.spacing.md }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>SERVER CONFIGURATION</Text>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <MaterialCommunityIcons name="server-network" size={22} color={t.colors.onSurfaceVariant} />
            <View style={{ flex: 1 }}>
              <Text variant="body">Nook Server</Text>
              <Text variant="caption" color={t.colors.onSurfaceVariant} numberOfLines={1}>{serverUrl}</Text>
            </View>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ToggleRow({
  icon,
  label,
  sub,
  value,
  onChange,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
      <MaterialIcons name={icon} size={22} color={t.colors.onSurfaceVariant} />
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {sub ? <Text variant="caption" color={t.colors.onSurfaceVariant}>{sub}</Text> : null}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          padding: 3,
          backgroundColor: value ? t.colors.primaryContainer : t.colors.surfaceContainerHighest,
          alignItems: value ? 'flex-end' : 'flex-start',
        }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: value ? t.colors.onPrimary : t.colors.outline }} />
      </View>
    </Pressable>
  );
}
