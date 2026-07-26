/**
 * App-open lock. When enabled in Preferences, the app requires device biometrics
 * (Face ID / fingerprint / passcode) on launch and whenever it returns from the
 * background. Only active while signed in — there's nothing sensitive on the
 * connection/login screens. If the device has no biometrics enrolled it can't
 * lock the user out (it falls through).
 */
import { useCallback, useEffect, useState } from 'react';
import { View, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Text, Button } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const enabled = useSettings((s) => s.prefs.appLock);
  const token = useAuth((s) => s.token);
  const active = enabled && !!token;

  const [locked, setLocked] = useState(active);
  const [checking, setChecking] = useState(false);

  // Lock/unlock as the toggle or auth state changes.
  useEffect(() => {
    setLocked(active);
  }, [active]);

  // Re-lock when the app is sent to the background.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') setLocked(true);
    });
    return () => sub.remove();
  }, [active]);

  const unlock = useCallback(async () => {
    setChecking(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setLocked(false); // nothing to authenticate against — don't lock out
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Nook Photos',
        fallbackLabel: 'Use passcode',
      });
      setLocked(!res.success);
    } catch {
      // keep locked; the user can retry
    } finally {
      setChecking(false);
    }
  }, []);

  // Prompt automatically whenever we become locked.
  useEffect(() => {
    if (active && locked && !checking) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, locked]);

  if (active && locked) return <LockScreen checking={checking} onUnlock={unlock} />;
  return <>{children}</>;
}

function LockScreen({ checking, onUnlock }: { checking: boolean; onUnlock: () => void }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.lg, padding: 24 }}>
        <MaterialIcons name="lock" size={56} color={t.colors.primaryContainer} />
        <Text variant="title">Nook Photos is locked</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
          {checking ? 'Authenticating…' : 'Unlock with Face ID or your passcode to continue.'}
        </Text>
        {!checking ? <Button title="Unlock" onPress={onUnlock} style={{ minWidth: 180 }} /> : null}
      </View>
    </SafeAreaView>
  );
}
