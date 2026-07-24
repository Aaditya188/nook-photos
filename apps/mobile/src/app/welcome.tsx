/**
 * Post-setup onboarding — a five-step guide mirroring the web Onboarding, sized
 * for mobile. Shown right after creating the first (admin) account; "Get
 * started" drops into the tabs.
 */
import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { router, Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAccount } from '@nook/core';
import { Screen, Text, Button } from '@/components/ui';
import { useTheme } from '@/theme';

const STEPS: { key: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string; body: string }[] = [
  { key: 'Welcome', icon: 'party-popper', title: 'Your Nook server is alive', body: 'You are the admin of your own photo cloud. Everything your devices back up stays on hardware you control — no subscriptions, no strangers.' },
  { key: 'Always on', icon: 'server-network', title: 'Keep the server running', body: 'Your Nook server backs up and serves your library. Leave it powered on and connected, and your phone syncs to it automatically whenever you open the app.' },
  { key: 'Your phone', icon: 'cellphone-check', title: 'Back up this phone', body: 'Turn on Backup & Sync from Profile to upload your camera roll in original quality. New photos upload in the background while the app is open.' },
  { key: 'Go anywhere', icon: 'earth', title: 'Reach it from anywhere', body: 'On your home Wi-Fi the app talks to the server directly for fast backups. Set a public URL on the server and you can browse and share from anywhere too.' },
  { key: 'Done', icon: 'check-decagram', title: "You're all set", body: 'Search understands content — try "sunset", "dog", or a person. Faces, places, trips and memories fill in automatically as your library indexes.' },
];

export default function WelcomeScreen() {
  const t = useTheme();
  const account = useAccount();
  const [step, setStep] = useState(0);
  const s = STEPS[step]!;
  const last = step === STEPS.length - 1;

  const finish = () => router.replace('/(tabs)');

  return (
    <Screen scroll edges={['top', 'bottom']} contentStyle={{ paddingTop: t.spacing.lg, gap: t.spacing.xl, flexGrow: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Progress dots */}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {STEPS.map((st, i) => (
          <View
            key={st.key}
            style={{
              width: i === step ? 22 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i <= step ? t.colors.primaryContainer : t.colors.surfaceContainerHigh,
            }}
          />
        ))}
      </View>

      <View style={{ flex: 1, gap: t.spacing.lg, justifyContent: 'center' }}>
        <View
          style={{
            width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
            backgroundColor: t.colors.primaryContainer, alignSelf: 'flex-start',
          }}>
          <MaterialCommunityIcons name={s.icon} size={36} color={t.colors.onPrimary} />
        </View>
        <Text variant="displayLarge">{s.title}</Text>
        <Text variant="body" color={t.colors.onSurfaceVariant} style={{ lineHeight: 24 }}>{s.body}</Text>
        {step === 0 && account.data?.displayName ? (
          <Text variant="titleSmall" color={t.colors.primaryContainer}>Welcome, {account.data.displayName}.</Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
        {step > 0 ? (
          <Button title="Back" variant="ghost" onPress={() => setStep((n) => n - 1)} />
        ) : (
          <Pressable onPress={finish} style={{ paddingVertical: t.spacing.sm, paddingHorizontal: t.spacing.md }}>
            <Text variant="label" color={t.colors.onSurfaceVariant}>Skip</Text>
          </Pressable>
        )}
        <Button title={last ? 'Get started' : 'Continue'} onPress={() => (last ? finish() : setStep((n) => n + 1))} />
      </View>
    </Screen>
  );
}
