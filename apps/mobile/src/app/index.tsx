import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme';

export default function Index() {
  const status = useAuth((s) => s.status);
  const t = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background }}>
        <ActivityIndicator color={t.colors.primaryContainer} />
      </View>
    );
  }
  return <Redirect href={status === 'authed' ? '/(tabs)' : '/(auth)/server'} />;
}
