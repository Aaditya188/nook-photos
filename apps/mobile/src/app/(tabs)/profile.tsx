import { View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useAccount, type ThemeMode } from '@nook/core';
import { Screen, Text, Card, Button, Divider } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

const MODES: (ThemeMode | 'system')[] = ['light', 'dark', 'system'];

export default function ProfileScreen() {
  const t = useTheme();
  const cachedUser = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);
  const account = useAccount();

  const user = account.data ?? cachedUser;

  return (
    <Screen scroll contentStyle={{ paddingTop: t.spacing.md, gap: t.spacing.lg, paddingBottom: t.spacing.xxl }}>
      <Text variant="headline">Profile</Text>

      <Card style={{ alignItems: 'center', gap: t.spacing.sm }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: t.colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text variant="headline" color={t.colors.onPrimary}>
            {(user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase()}
          </Text>
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
