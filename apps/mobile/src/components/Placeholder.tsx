import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Screen, Text, Card } from '@/components/ui';
import { useTheme } from '@/theme';

export function Placeholder({
  title,
  icon,
  note,
}: {
  title: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  note: string;
}) {
  const t = useTheme();
  return (
    <Screen contentStyle={{ paddingTop: t.spacing.md, gap: t.spacing.lg }}>
      <Text variant="headline">{title}</Text>
      <Card style={{ alignItems: 'center', gap: t.spacing.sm, paddingVertical: t.spacing.xxl }}>
        <MaterialIcons name={icon} size={40} color={t.colors.outline} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text variant="titleSmall" color={t.colors.onSurfaceVariant}>
            Coming soon
          </Text>
          <Text variant="caption" color={t.colors.outline} style={{ textAlign: 'center' }}>
            {note}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
