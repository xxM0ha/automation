import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import PrimeNative from '../../modules/prime-native';
import type { DemoEventPayload } from '../../modules/prime-native';
import { Text } from './Text';
import { Button } from './Button';
import { Icon } from './Icon';
import { colors, spacing, radius } from '../theme';

export function NativeDebugCard() {
  const [pong, setPong] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  const available = PrimeNative != null;

  useEffect(() => {
    if (!PrimeNative) return;
    const sub = PrimeNative.addListener('onDemo', (e: DemoEventPayload) => {
      setTickCount(e.count);
    });
    return () => sub.remove();
  }, []);

  const onPing = async () => {
    if (!PrimeNative) return;
    setError(null);
    try {
      const result = await PrimeNative.ping();
      setPong(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleTicker = async () => {
    if (!PrimeNative) return;
    setError(null);
    try {
      if (ticking) {
        await PrimeNative.stopDemoTicker();
      } else {
        setTickCount(0);
        await PrimeNative.startDemoTicker();
      }
      setTicking(!ticking);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Icon name="developer_mode" size={20} color={colors.tertiary} />
        <Text variant="labelLg" color={colors.tertiary}>جسر النظام (تشخيص)</Text>
      </View>

      {!available && (
        <View style={styles.notice}>
          <Icon name="info" size={18} color={colors.onSurfaceVariant} />
          <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
            الجسر الأصلي غير متاح في Expo Go. يحتاج إلى نسخة تطوير (EAS development build).
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <Text variant="bodySm" color={colors.onSurfaceVariant}>ping():</Text>
        <Text variant="labelMd" color={pong ? colors.successFgStrong : colors.onSurfaceVariant}>
          {pong ?? 'لم يُستدعَ بعد'}
        </Text>
      </View>

      <View style={styles.row}>
        <Text variant="bodySm" color={colors.onSurfaceVariant}>onDemo count:</Text>
        <Text variant="labelMd" color={ticking ? colors.primary : colors.onSurfaceVariant}>
          {tickCount}
        </Text>
      </View>

      {error && (
        <Text variant="bodySm" color={colors.error} style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        <Button label="ping" icon="check" onPress={onPing} disabled={!available} />
        <Button
          label={ticking ? 'إيقاف العدّاد' : 'بدء العدّاد'}
          variant={ticking ? 'danger' : 'secondary'}
          onPress={toggleTicker}
          disabled={!available}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.tertiaryFixed,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.tertiaryFixedDim,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
