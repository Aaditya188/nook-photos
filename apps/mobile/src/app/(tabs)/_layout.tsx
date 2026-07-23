import { Tabs } from 'expo-router';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.primaryContainer,
        tabBarInactiveTintColor: t.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: t.colors.surface,
          borderTopColor: t.colors.outlineVariant,
          borderTopWidth: 0.5,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="photo-library" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="albums"
        options={{
          title: 'Albums',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="photo-album" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sharing"
        options={{
          title: 'Sharing',
          tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="share-variant" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
