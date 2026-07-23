/**
 * Gates its children behind device biometrics (Face ID / fingerprint / passcode).
 * Used for Hidden and Locked. If the device has no biometric hardware/enrollment,
 * it falls through (nothing to gate with) rather than locking the user out.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Text, Button } from '@/components/ui';
import { useTheme } from '@/theme';

export function BiometricGate({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  const authenticate = useCallback(async () => {
    setChecking(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setUnlocked(true); // nothing to authenticate against
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: `Unlock ${title}`,
        fallbackLabel: 'Use passcode',
      });
      setUnlocked(res.success);
    } catch {
      setUnlocked(false);
    } finally {
      setChecking(false);
    }
  }, [title]);

  useEffect(() => {
    void authenticate();
  }, [authenticate]);

  if (unlocked) return <>{children}</>;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={26} color={t.colors.onSurface} />
        </Pressable>
        <Text variant="title">{title}</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.lg, padding: 24 }}>
        <MaterialIcons name="lock" size={52} color={t.colors.outline} />
        <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
          {title} is protected. {checking ? 'Authenticating…' : 'Authentication required.'}
        </Text>
        {!checking ? <Button title="Unlock" onPress={authenticate} style={{ minWidth: 160 }} /> : null}
      </View>
    </SafeAreaView>
  );
}
