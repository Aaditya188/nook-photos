import { View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useAccount, useNookClient, type ThemeMode } from '@nook/core';
import { Screen, Text, Card, Button, Divider } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

const MODES: (ThemeMode | 'system')[] = ['light', 'dark', 'system'];

// null = the default green accent; the swatch shows what green looks like.
const ACCENTS: { name: string; value: string | null; swatch: string }[] = [
  { name: 'Green', value: null, swatch: '#57d38a' },
  { name: 'Blue', value: '#5b9dff', swatch: '#5b9dff' },
  { name: 'Purple', value: '#b18cff', swatch: '#b18cff' },
  { name: 'Pink', value: '#ff6b8a', swatch: '#ff6b8a' },
  { name: 'Orange', value: '#ff9f5b', swatch: '#ff9f5b' },
  { name: 'Teal', value: '#4fd6c7', swatch: '#4fd6c7' },
];

export default function ProfileScreen() {
  const t = useTheme();
  const cachedUser = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);
  const prefs = useSettings((s) => s.prefs);
  const setPref = useSettings((s) => s.setPref);
  const account = useAccount();
  const client = useNookClient();

  const user = account.data ?? cachedUser;
  const avatarUrl = account.data?.avatarUrl;

  return (
    <Screen scroll contentStyle={{ paddingTop: t.spacing.md, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Text variant="headline">Profile</Text>

      <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            overflow: 'hidden',
            backgroundColor: t.colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {avatarUrl ? (
            <Image
              source={{ uri: client.url(avatarUrl), headers: client.authHeaders() }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text variant="headline" color={t.colors.onPrimary}>
              {(user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <Text variant="title">{user?.displayName ?? user?.username ?? 'Account'}</Text>
        {user?.email ? (
          <Text variant="caption" color={t.colors.onSurfaceVariant}>
            {user.email}
          </Text>
        ) : null}
        {user?.role ? (
          <View style={{ backgroundColor: t.colors.surfaceContainerHigh, paddingHorizontal: 10, paddingVertical: 3, borderRadius: t.radius.pill }}>
            <Text variant="caption" color={t.colors.onSurfaceVariant}>
              {user.role}
            </Text>
          </View>
        ) : null}
      </Card>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          ACCOUNT
        </Text>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <AccountRow icon="badge" label="Edit Profile" onPress={() => router.push('/edit-profile')} />
          <Divider />
          <AccountRow icon="lock-outline" label="Change Password" onPress={() => router.push('/change-password')} />
          <Divider />
          <AccountRow icon="security" label="Security & Two-Factor" onPress={() => router.push('/security')} />
          <Divider />
          <AccountRow icon="devices" label="Signed-in Devices" onPress={() => router.push('/devices')} />
        </Card>
      </View>

      {user?.role === 'admin' ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="label" color={t.colors.onSurfaceVariant}>
            ADMIN
          </Text>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <AccountRow icon="group" label="Users" onPress={() => router.push('/users')} />
            <Divider />
            <AccountRow icon="dns" label="Server Settings" onPress={() => router.push('/server-settings')} />
          </Card>
        </View>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          BACKUP &amp; SYNC
        </Text>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Pressable
            onPress={() => router.push('/backup')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
            <MaterialIcons name="cloud-upload" size={22} color={t.colors.primaryContainer} />
            <Text variant="body" style={{ flex: 1 }}>Backup &amp; Server</Text>
            <MaterialIcons name="chevron-right" size={22} color={t.colors.outline} />
          </Pressable>
        </Card>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          STORAGE
        </Text>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <AccountRow icon="content-copy" label="Find Duplicates" onPress={() => router.push('/duplicates')} />
        </Card>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          PREFERENCES
        </Text>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
            <MaterialIcons name="grid-view" size={22} color={t.colors.onSurfaceVariant} />
            <Text variant="body" style={{ flex: 1 }}>Grid size</Text>
            <Pressable onPress={() => setPref('gridColumns', Math.max(2, prefs.gridColumns - 1))} hitSlop={8} disabled={prefs.gridColumns <= 2}>
              <MaterialIcons name="remove-circle-outline" size={24} color={prefs.gridColumns <= 2 ? t.colors.outline : t.colors.primaryContainer} />
            </Pressable>
            <Text variant="body" style={{ minWidth: 20, textAlign: 'center' }}>{prefs.gridColumns}</Text>
            <Pressable onPress={() => setPref('gridColumns', Math.min(5, prefs.gridColumns + 1))} hitSlop={8} disabled={prefs.gridColumns >= 5}>
              <MaterialIcons name="add-circle-outline" size={24} color={prefs.gridColumns >= 5 ? t.colors.outline : t.colors.primaryContainer} />
            </Pressable>
          </View>
          <Divider />
          <PrefToggle icon="vibration" label="Haptic feedback" value={prefs.haptics} onChange={(v) => setPref('haptics', v)} />
          <Divider />
          <PrefToggle icon="delete-outline" label="Confirm before deleting" value={prefs.confirmDelete} onChange={(v) => setPref('confirmDelete', v)} />
          <Divider />
          <PrefToggle icon="play-circle-outline" label="Autoplay videos" value={prefs.autoplayVideos} onChange={(v) => setPref('autoplayVideos', v)} />
          <Divider />
          <PrefToggle icon="lock-outline" label="Require Face ID / passcode" value={prefs.appLock} onChange={(v) => setPref('appLock', v)} />
        </Card>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="label" color={t.colors.onSurfaceVariant}>
          APPEARANCE
        </Text>
        <Card style={{ padding: 6 }}>
          {MODES.map((m, i) => (
            <View key={m}>
              <Pressable
                onPress={() => setThemeMode(m)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: t.spacing.md }}>
                <Text variant="body" style={{ textTransform: 'capitalize' }}>
                  {m}
                </Text>
                {themeMode === m ? (
                  <MaterialIcons name="check" size={20} color={t.colors.primaryContainer} />
                ) : null}
              </Pressable>
              {i < MODES.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Card>
        <Card style={{ gap: t.spacing.md }}>
          <Text variant="body">Accent color</Text>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            {ACCENTS.map((a) => {
              const active = (prefs.accent ?? null) === a.value;
              return (
                <Pressable key={a.name} onPress={() => setPref('accent', a.value)} hitSlop={6}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: a.swatch,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: active ? 2 : 0,
                      borderColor: t.colors.onSurface,
                    }}>
                    {active ? <MaterialIcons name="check" size={18} color="#06140c" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      </View>

      <Button title="Sign Out" variant="tonal" onPress={() => logout()} />
    </Screen>
  );
}

function AccountRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
      <MaterialIcons name={icon} size={22} color={t.colors.onSurfaceVariant} />
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color={t.colors.outline} />
    </Pressable>
  );
}

function PrefToggle({
  icon,
  label,
  value,
  onChange,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
      <MaterialIcons name={icon} size={22} color={t.colors.onSurfaceVariant} />
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
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
