import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import { colors, spacing, radius } from '../theme';

export type PermissionStatus = 'granted' | 'missing';

type Props = {
  icon: IconName;
  title: string;
  description: string;
  status: PermissionStatus;
  onPress: () => void;
};

export function PermissionItem({ icon, title, description, status, onPress }: Props) {
  const isMissing = status === 'missing';

  return (
    <View
      style={[
        styles.row,
        isMissing
          ? { backgroundColor: 'rgba(255, 218, 214, 0.2)', borderColor: colors.errorContainer }
          : { backgroundColor: colors.surface, borderColor: colors.surfaceContainerHighest },
      ]}
    >
      <View style={styles.left}>
        <View
          style={[
            styles.iconCircle,
            isMissing
              ? { backgroundColor: colors.errorContainer }
              : { backgroundColor: colors.successBg },
          ]}
        >
          <Icon name={icon} size={20} color={isMissing ? colors.error : colors.successFg} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text variant="headlineMd" color={colors.onSurface}>{title}</Text>
            <View
              style={[
                styles.badge,
                isMissing
                  ? { backgroundColor: colors.errorContainer }
                  : { backgroundColor: colors.successBg },
              ]}
            >
              <Text
                variant="labelMd"
                color={isMissing ? colors.error : colors.successFgStrong}
                style={{ fontSize: 10 }}
              >
                {isMissing ? 'مفقود' : 'نشط'}
              </Text>
            </View>
          </View>
          <Text
            variant="bodySm"
            color={colors.onSurfaceVariant}
            style={{ marginTop: spacing.xs }}
          >
            {description}
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        {isMissing ? (
          <Button label="تفعيل الآن" variant="danger" onPress={onPress} />
        ) : (
          <Button label="إعدادات" variant="outline" onPress={onPress} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  actionRow: {
    alignItems: 'flex-start',
  },
});
