import { useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import PrimeNative from '../../modules/prime-native';
import { Text } from './Text';
import { Button } from './Button';
import { Icon } from './Icon';
import { colors, spacing, radius } from '../theme';

const COUNTDOWN_SECONDS = 6;

/**
 * Developer tool: after a delay (so you can switch to the target app and
 * navigate to the screen you want), dumps the full accessibility tree of
 * whatever is in the foreground to the Metro terminal — one node per line,
 * untruncated. Use it to discover the real viewIds / contentDescs for selectors.
 *
 * The delay runs NATIVELY (dumpForegroundAfter) so it keeps counting while
 * Prime is in the background — a JS timer would freeze the moment you switch
 * away and capture Prime itself.
 */
export function ScreenDumpCard() {
  const available = PrimeNative != null;
  const [counting, setCounting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const display = useRef<ReturnType<typeof setInterval> | null>(null);

  const logSnapshot = (snap: { package: string | null; nodes: any[] }) => {
    // eslint-disable-next-line no-console
    console.log('===== SCREEN DUMP =====');
    // eslint-disable-next-line no-console
    console.log('package:', snap.package);
    snap.nodes.forEach((n, i) => {
      const cx =
        typeof n.left === 'number' && typeof n.right === 'number'
          ? Math.round((n.left + n.right) / 2)
          : null;
      const cy =
        typeof n.top === 'number' && typeof n.bottom === 'number'
          ? Math.round((n.top + n.bottom) / 2)
          : null;
      const parts = [
        `#${i}`,
        n.viewId ? `id=${n.viewId}` : null,
        n.text ? `text="${n.text}"` : null,
        n.contentDesc ? `desc="${n.contentDesc}"` : null,
        n.clickable ? 'clickable' : null,
        cx != null && cy != null ? `@(${cx},${cy})` : null,
      ].filter(Boolean);
      // eslint-disable-next-line no-console
      console.log(parts.join('  '));
    });
    // eslint-disable-next-line no-console
    console.log(`===== END (${snap.nodes.length} nodes) =====`);
    setSummary(`${snap.package ?? '?'} · ${snap.nodes.length} عنصر — انظر الطرفية`);
  };

  const start = () => {
    if (counting || !PrimeNative) return;
    setSummary(null);
    setCounting(true);
    setRemaining(COUNTDOWN_SECONDS);

    // Cosmetic countdown (may freeze if Prime is backgrounded — that's fine,
    // the real capture is the native call below).
    display.current = setInterval(() => {
      setRemaining((r) => (r <= 1 ? 0 : r - 1));
    }, 1000);

    // The actual capture: native waits, then snapshots the foreground.
    PrimeNative.dumpForegroundAfter(COUNTDOWN_SECONDS * 1000)
      .then((snap) => logSnapshot(snap))
      .catch((e) => setSummary(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (display.current) clearInterval(display.current);
        setCounting(false);
        setRemaining(0);
      });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Icon name="download" size={20} color={colors.tertiary} />
        <Text variant="labelLg" color={colors.tertiary}>التقاط الشاشة (تشخيص)</Text>
      </View>

      <Text variant="bodySm" color={colors.onSurfaceVariant}>
        اضغط ثمّ انتقل خلال {COUNTDOWN_SECONDS} ثوانٍ إلى الشاشة المطلوبة (يمكنك تركها
        مفتوحة مسبقاً). يُلتقط المحتوى أصلياً ولو كان برايم في الخلفية، ويُطبع في الطرفية.
      </Text>

      {counting ? (
        <View style={styles.counter}>
          <Text variant="displayMd" color={colors.primary}>{remaining}</Text>
        </View>
      ) : null}

      {summary ? (
        <Text variant="labelMd" color={colors.onSurfaceVariant}>{summary}</Text>
      ) : null}

      <Button
        label={counting ? `الالتقاط بعد ${remaining}…` : 'التقاط بعد عدّ تنازلي'}
        icon="download"
        onPress={start}
        disabled={!available || counting}
      />

      {!available ? (
        <Text variant="labelMd" color={colors.outline}>
          يتطلب نسخة التطوير (dev build).
        </Text>
      ) : null}
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
    marginBottom: spacing.xs,
  },
  counter: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
});
