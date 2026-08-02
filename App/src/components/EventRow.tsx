import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { colors, spacing } from '../theme';

export type EventStatus = 'success' | 'processing' | 'failure' | 'info';

type Props = {
  time: string;        // "10:42:05"
  title: string;
  description: string;
  status: EventStatus;
  showDivider?: boolean;
};

const STATUS_META: Record<EventStatus, { label: string; icon: IconName; bg: string; fg: string }> = {
  success:    { label: 'نجاح',         icon: 'check', bg: colors.primaryFixed,    fg: colors.onPrimaryFixed },
  processing: { label: 'قيد المعالجة', icon: 'sync',  bg: colors.secondaryFixed,  fg: colors.onSecondaryFixed },
  failure:    { label: 'فشل',          icon: 'error', bg: colors.errorContainer,  fg: colors.onErrorContainer },
  info:       { label: 'معلومات',      icon: 'info',  bg: colors.surfaceVariant,  fg: colors.onSurfaceVariant },
};

export function EventRow({ time, title, description, status, showDivider = true }: Props) {
  const meta = STATUS_META[status];

  return (
    <View
      style={[
        styles.row,
        showDivider && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.surfaceVariant,
        },
      ]}
    >
      <View style={styles.left}>
        <Text variant="bodySm" color={colors.onSurfaceVariant} style={styles.time}>
          {time}
        </Text>
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" color={colors.onSurface}>{title}</Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ marginTop: 2 }}>
            {description}
          </Text>
        </View>
      </View>

      <View style={[styles.badge, { backgroundColor: meta.bg }]}>
        <Icon name={meta.icon} size={14} color={meta.fg} />
        <Text variant="labelMd" color={meta.fg}>{meta.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    flex: 1,
  },
  time: {
    width: 64,
    textAlign: 'right',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: 9999,
  },
});
