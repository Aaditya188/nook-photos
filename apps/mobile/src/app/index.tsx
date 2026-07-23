import { Redirect } from 'expo-router';
import { useAuth } from '@/store/auth';
import { BrandLoader } from '@/components/ui';

export default function Index() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <BrandLoader />;
  return <Redirect href={status === 'authed' ? '/(tabs)' : '/(auth)/server'} />;
}
