import { useEffect, useRef } from 'react';
import { View, StyleSheet, Switch, Animated, Easing, Platform, Pressable } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { colors, spacing, radius } from '../theme';

export type AutomationStatus = 'extracting' | 'idle' | 'error';
export type IconTone = 'primary' | 'tertiary' | 'secondary';

type Props = {
  name: string;
  icon: IconName;
  iconTone: IconTone;
  status: AutomationStatus;
  enabled: boolean;
  /** Optional label below the status pill (e.g. "12 دورة"). */
  meta?: string;
  /** Tap handler for the whole card — e.g. open the config detail screen. */
  onPress?: () => void;
  /** If omitted, the toggle renders read-only (the value is config-driven). */
  onToggle?: (next: boolean) => void;
};

const ICON_TONES: Record<IconTone, { bg: string; fg: string }> = {
  // Tints replicate the bg-*-container/10 from the Tailwind mockup.
  primary: { bg: 'rgba(33, 112, 228, 0.1)', fg: colors.primary },
  tertiary: { bg: 'rgba(183, 91, 0, 0.1)', fg: colors.tertiaryContainer },
  secondary: { bg: colors.surfaceContainer, fg: colors.secondary },
};

export function AutomationCard({ name, icon, iconTone, status, enabled, meta, onPress, onToggle }: Props) {
  const tone = ICON_TONES[iconTone];
  const isExtracting = status === 'extracting';
  const isError = status === 'error';
  const statusBg = isExtracting
    ? 'rgba(173, 198, 255, 0.2)'
    : isError
      ? colors.errorContainer
      : colors.surfaceContainer;
  const statusFg = isExtracting
    ? colors.primary
    : isError
      ? colors.error
      : colors.onSurfaceVariant;
  const statusLabel = isExtracting ? 'يعمل' : isError ? 'خطأ' : 'متوقّف';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconTile, { backgroundColor: tone.bg }]}>
          <Icon name={icon} size={24} color={tone.fg} />
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          disabled={!onToggle}
          trackColor={{ false: colors.surfaceVariant, true: colors.primary }}
          thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
          ios_backgroundColor={colors.surfaceVariant}
        />
      </View>

      <Text
        variant="headlineMd"
        color={enabled ? colors.onSurface : colors.onSurfaceVariant}
        style={{ marginBottom: spacing.xs }}
      >
        {name}
      </Text>

      <View style={styles.statusRow}>
        <StatusDot active={isExtracting} color={isError ? colors.error : undefined} />
        <View style={[styles.pill, { backgroundColor: statusBg }]}>
          <Text variant="labelMd" color={statusFg}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {meta ? (
        <Text variant="labelMd" color={colors.outline} style={{ marginTop: spacing.xs }}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

function StatusDot({ active, color }: { active: boolean; color?: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color ?? (active ? colors.primary : colors.outlineVariant),
          opacity: active ? opacity : 1,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194, 198, 214, 0.3)',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardPressed: {
    opacity: 0.85,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 9999,
  },
});
