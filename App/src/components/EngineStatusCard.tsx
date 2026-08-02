import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Icon } from './Icon';
import { colors, spacing, radius } from '../theme';

type Props = {
  /** True if any of this device's tasks are currently running. */
  running: boolean;
  /** Uptime in minutes, computed from the earliest running task's startedAt. */
  uptimeMinutes: number;
  /** Sum of iterationCount across this device's tasks. */
  totalIterations: number;
  /** How many of this device's tasks are running right now. */
  runningCount: number;
  /** Last error message from any of this device's tasks, if any. */
  lastError: string | null;
};

/** Eastern-Arabic digits for the metric numbers. */
function arNum(n: number): string {
  return n.toLocaleString('ar-EG', { useGrouping: false });
}

/** Format minutes as e.g. "٢ ساعة ١٠ د" or just "١٠ د" under an hour. */
function formatUptime(minutes: number): string {
  if (minutes <= 0) return '٠ د';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${arNum(m)} د`;
  if (m === 0) return `${arNum(h)} ساعة`;
  return `${arNum(h)} ساعة ${arNum(m)} د`;
}

export function EngineStatusCard({
  running,
  uptimeMinutes,
  totalIterations,
  runningCount,
  lastError,
}: Props) {
  const hasError = lastError != null;
  // The card has three faces: running, error, or idle.
  const tone = hasError
    ? { fg: colors.error, bg: colors.errorContainer, strong: colors.onErrorContainer }
    : running
      ? { fg: colors.successFg, bg: colors.successBg, strong: colors.successFgStrong }
      : { fg: colors.onSurfaceVariant, bg: colors.surfaceContainerHigh, strong: colors.onSurface };

  const icon = hasError ? 'error' : running ? 'check_circle' : 'info';
  const pillLabel = hasError ? 'خطأ' : running ? 'يعمل' : 'متوقف';
  const heading = hasError
    ? 'المحرك واجه خطأً'
    : running
      ? 'النظام يعمل بكفاءة'
      : 'المحرك متوقف';
  const subline = hasError
    ? lastError
    : running
      ? 'المهام تعمل بدون أخطاء. لا يتطلب أي تدخل حالي.'
      : 'لا توجد مهام نشطة على هذا الجهاز حالياً.';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconCircle, { backgroundColor: tone.bg }]}>
            <Icon name={icon} size={26} color={tone.fg} />
          </View>
          <View>
            <Text variant="headlineMd" color={colors.onSurface}>حالة المحرك</Text>
            <Text variant="bodySm" color={colors.onSurfaceVariant}>
              المهام النشطة: {arNum(runningCount)}
            </Text>
          </View>
        </View>
        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
          <Text variant="labelMd" color={tone.strong}>{pillLabel}</Text>
        </View>
      </View>

      <View style={styles.center}>
        <Text variant="displayMd" color={tone.fg} style={{ marginBottom: spacing.sm, textAlign: 'center' }}>
          {heading}
        </Text>
        <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
          {subline}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text variant="labelMd" color={colors.onSurfaceVariant}>عدد الدورات</Text>
          <View style={styles.statValue}>
            <Text variant="headlineLg" color={colors.onSurface}>{arNum(totalIterations)}</Text>
            <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ marginRight: spacing.xs }}>
              دورة
            </Text>
          </View>
        </View>
        <View style={styles.statCol}>
          <Text variant="labelMd" color={colors.onSurfaceVariant}>وقت التشغيل</Text>
          <View style={styles.statValue}>
            <Text variant="headlineLg" color={colors.onSurface}>{formatUptime(uptimeMinutes)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    paddingHorizontal: spacing.md - 4,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  center: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceContainerHighest,
    paddingTop: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.md,
  },
  statCol: {
    flex: 1,
  },
  statValue: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
  },
});
