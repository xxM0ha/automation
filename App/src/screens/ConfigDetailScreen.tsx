import { useEffect, useRef, type ReactNode } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { useEngine, type EngineMode } from '../automation/EngineController';
import type { PlatformConfig, Selector, Step, StepType } from '../automation/config.types';
import type { RunLogLevel } from '../automation/interpreter';
import { useAccessibilityStatus } from '../hooks/useAccessibilityStatus';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing, radius } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ConfigDetail'>;

const STRATEGY_LABELS: Record<string, string> = {
  package: 'حزمة التطبيق',
  viewId: 'معرّف العنصر',
  text: 'النص الظاهر',
  contentDesc: 'وصف الوصول',
};

const MATCH_LABELS: Record<string, string> = {
  exact: 'تطابق تام',
  contains: 'يحتوي على',
  regex: 'تعبير نمطي',
};

const STEP_META: Record<StepType, { icon: IconName; label: string }> = {
  launchApp:   { icon: 'launch',       label: 'تشغيل التطبيق' },
  waitForApp:  { icon: 'launch',       label: 'انتظار التطبيق في المقدّمة' },
  waitFor:     { icon: 'schedule',     label: 'انتظار ظهور عنصر' },
  watchFor:    { icon: 'my_location',  label: 'مراقبة الشاشة' },
  wait:        { icon: 'schedule',     label: 'تأخير' },
  tap:         { icon: 'touch_app',    label: 'نقر' },
  tapInRow:    { icon: 'touch_app',    label: 'نقر في صف' },
  tapAt:       { icon: 'touch_app',    label: 'نقر عند إحداثيات' },
  longPress:   { icon: 'touch_app',    label: 'ضغط مطوّل' },
  doubleTap:   { icon: 'touch_app',    label: 'نقر مزدوج' },
  scroll:      { icon: 'swap_vert',    label: 'تمرير' },
  scrollUntil: { icon: 'swap_vert',    label: 'تمرير حتى الظهور' },
  swipe:       { icon: 'swap_vert',    label: 'سحب' },
  setText:     { icon: 'download',     label: 'إدخال نص' },
  clearText:   { icon: 'download',     label: 'مسح النص' },
  exists:      { icon: 'my_location',  label: 'تحقّق من الوجود' },
  readField:   { icon: 'download',     label: 'قراءة حقل' },
  readScreen:  { icon: 'download',     label: 'قراءة الشاشة' },
  readScreenScrolling: { icon: 'download', label: 'قراءة الشاشة مع التمرير' },
  extractList: { icon: 'dynamic_feed', label: 'استخراج قائمة' },
  back:        { icon: 'arrow_forward', label: 'زر الرجوع' },
  home:        { icon: 'arrow_forward', label: 'زر الرئيسية' },
  recents:     { icon: 'dynamic_feed', label: 'قائمة التطبيقات' },
  openNotifications: { icon: 'info',   label: 'فتح الإشعارات' },
  forEach:     { icon: 'dynamic_feed', label: 'تكرار لكل عنصر' },
  if:          { icon: 'call_split',   label: 'شرط' },
  sendRequest: { icon: 'sync',         label: 'إرسال طلب' },
};

const LOG_COLORS: Record<RunLogLevel, string> = {
  info: colors.onSurfaceVariant,
  step: colors.primary,
  success: colors.successFgStrong,
  error: colors.error,
};

/** A short human-readable summary of one step's payload. */
function stepSummary(step: Step): string {
  switch (step.type) {
    case 'launchApp':
      return step.selector;
    case 'waitForApp':
      return `${step.selector} · حتى ${step.timeoutMs} ملّي`;
    case 'waitFor':
      return `${step.selector} · حتى ${step.timeoutMs} ملّي`;
    case 'watchFor':
      return `${step.selector} · كل ${step.intervalMs ?? 500} ملّي`;
    case 'wait':
      return `${step.durationMs} ملّي`;
    case 'tap':
      return step.selector;
    case 'tapInRow':
      return `${step.anchor} ← ${step.target}`;
    case 'tapAt':
      return `${step.x}, ${step.y}`;
    case 'longPress':
      return step.selector;
    case 'doubleTap':
      return step.selector;
    case 'scroll':
      return `${step.selector} · ${step.direction === 'down' ? 'لأسفل' : 'لأعلى'}`;
    case 'scrollUntil':
      return `حتى ${step.until} · ${step.direction === 'down' ? 'لأسفل' : 'لأعلى'} · ${step.maxScrollPasses}×`;
    case 'swipe':
      return `${step.direction}${step.selector ? ` · ${step.selector}` : ''}`;
    case 'setText':
      return `${step.selector} = "${step.text}"`;
    case 'clearText':
      return step.selector;
    case 'exists':
      return `${step.selector} → ${step.saveAs}`;
    case 'readField':
      return `${step.selector} ← ${step.saveAs}`;
    case 'readScreen':
      return `→ ${step.saveAs}`;
    case 'readScreenScrolling':
      return `→ ${step.saveAs}` + (step.until ? ` (حتى ${step.until})` : '');
    case 'extractList':
      return `${step.itemSelector} · ${Object.keys(step.fields).length} حقول`;
    case 'back':
      return 'العودة للشاشة السابقة';
    case 'home':
      return 'الشاشة الرئيسية';
    case 'recents':
      return 'قائمة التطبيقات الأخيرة';
    case 'openNotifications':
      return 'شريط الإشعارات';
    case 'forEach':
      return `${step.items} → ${step.as} · ${step.do.length} خطوة`;
    case 'if':
      return `${step.condition.var} · ${step.condition.op}`;
    case 'sendRequest':
      return step.endpoint + (step.saveAs ? ` ← ${step.saveAs}` : '');
  }
}

export function ConfigDetailScreen({ route, navigation }: Props) {
  const { platform } = route.params;
  const { getPlatform, config } = useAutomationConfig();
  const insets = useSafeAreaInsets();
  const cfg = getPlatform(platform);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Icon name="arrow_forward" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="headlineLg" color={colors.onSurface}>{cfg?.label ?? platform}</Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant}>إعدادات الأتمتة</Text>
        </View>
        {cfg ? <StatusPill enabled={cfg.enabled} /> : null}
      </View>

      {!cfg ? (
        <View style={styles.missing}>
          <Icon name="error" size={32} color={colors.onSurfaceVariant} />
          <Text variant="bodyLg" color={colors.onSurfaceVariant}>
            لا توجد إعدادات لهذه المنصة.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl2 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.notice}>
            <Icon name="lock" size={18} color={colors.onSurfaceVariant} />
            <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ flex: 1 }}>
              للعرض فقط — تُدار الإعدادات من لوحة التحكم في الخادم.
            </Text>
          </View>

          <RunPanel config={cfg} />

          <Section icon="dynamic_feed" title={`تدفق المهام · ${cfg.flow.length}`}>
            <FlowSteps steps={cfg.flow} />
          </Section>

          <Section icon="tune" title="المُعاملات">
            <Row icon="schedule" label="فترة المسح" value={`${cfg.parameters.scanIntervalSec} ثانية`} />
            <Row
              icon="bolt"
              label="التأكيد التلقائي"
              value={cfg.parameters.autoConfirm ? 'مُفعّل' : 'مُعطّل'}
            />
            <Row
              icon="dynamic_feed"
              label="وضع التشغيل"
              value={cfg.runMode === 'continuous' ? 'مستمر' : 'مرّة واحدة'}
            />
          </Section>

          <Section
            icon="my_location"
            title={`المُحدِّدات · ${Object.keys(cfg.selectors).length}`}
          >
            {Object.entries(cfg.selectors).map(([key, selector]) => (
              <SelectorRow key={key} name={key} selector={selector} />
            ))}
          </Section>

          <Text variant="labelMd" color={colors.outline} style={styles.meta}>
            إصدار المخطّط {config.schemaVersion} · المصدر: ملف محلي
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Drives this platform's engine state via the global EngineController.
 * The actual run loop lives in the controller, so navigating away does
 * not stop a continuous run.
 */
function RunPanel({ config }: { config: PlatformConfig }) {
  const engine = useEngine();
  const state = engine.stateOf(config.platform);
  const { available, enabled } = useAccessibilityStatus();
  const scrollRef = useRef<ScrollView | null>(null);

  const running = state.status === 'running';
  const paused = state.status === 'paused';
  const active = running || paused;

  // Auto-scroll the log to the bottom as new entries arrive.
  useEffect(() => {
    if (scrollRef.current && state.log.length > 0) {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [state.log.length]);

  const start = (mode: EngineMode) => engine.start(config.platform, mode);
  const stop = () => engine.stop(config.platform);
  const pause = () => engine.pause(config.platform);
  const resume = () => engine.resume(config.platform);

  const realHint = !available
    ? 'التشغيل الحقيقي يتطلب نسخة تطوير (dev build)'
    : !enabled
      ? 'فعّل خدمة الوصول من شاشة النظام أولاً'
      : null;

  return (
    <View style={styles.runCard}>
      <View style={styles.runHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" color={colors.onSurface}>تشغيل التدفق</Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant}>
            {config.runMode === 'continuous'
              ? 'وضع مستمر — يستمر بالعمل في الخلفية حتى تُوقفه.'
              : 'وضع مرّة واحدة — يعمل ثم يتوقّف.'}
          </Text>
        </View>
        {state.iterationCount > 0 ? (
          <View style={styles.iterPill}>
            <Text variant="labelMd" color={colors.primary}>{state.iterationCount} دورة</Text>
          </View>
        ) : null}
      </View>

      {active ? (
        <View style={styles.runButtons}>
          {state.mode === 'native' ? (
            paused ? (
              <Button label="استئناف" icon="bolt" variant="secondary" onPress={resume} />
            ) : (
              <Button label="إيقاف مؤقت" icon="schedule" variant="secondary" onPress={pause} />
            )
          ) : null}
          <Button label="إيقاف" icon="power_settings_new" variant="danger" onPress={stop} />
        </View>
      ) : (
        <View style={styles.runButtons}>
          <Button
            label="تجريبي"
            icon="bolt"
            variant="secondary"
            onPress={() => start('dry')}
          />
          <Button
            label="حقيقي"
            icon="launch"
            onPress={() => start('native')}
            disabled={!available || !enabled}
          />
        </View>
      )}

      {paused ? (
        <Text variant="labelMd" color={colors.tertiary}>متوقّف مؤقتاً — لا يعمل حتى الاستئناف.</Text>
      ) : null}

      {realHint && !active ? (
        <Text variant="labelMd" color={colors.outline}>{realHint}</Text>
      ) : null}

      {state.log.length > 0 ? (
        <ScrollView
          ref={(r) => {
            scrollRef.current = r;
          }}
          style={styles.logScroll}
          contentContainerStyle={styles.logBox}
        >
          {state.log.map((entry) => (
            <View
              key={entry.id}
              style={[styles.logRow, { marginStart: entry.depth * spacing.md }]}
            >
              <View style={[styles.logDot, { backgroundColor: LOG_COLORS[entry.level] }]} />
              <Text variant="bodySm" color={LOG_COLORS[entry.level]} style={{ flex: 1 }}>
                {entry.message}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {state.status === 'error' && state.lastError ? (
        <View style={[styles.resultBar, { backgroundColor: colors.errorContainer }]}>
          <Icon name="error" size={18} color={colors.error} />
          <Text variant="labelMd" color={colors.error} style={{ flex: 1 }}>
            {state.lastError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <View
      style={[
        styles.statusPill,
        { backgroundColor: enabled ? colors.successBg : colors.surfaceContainer },
      ]}
    >
      <Text variant="labelMd" color={enabled ? colors.successFgStrong : colors.onSurfaceVariant}>
        {enabled ? 'مُفعّل' : 'مُعطّل'}
      </Text>
    </View>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Icon name={icon} size={20} color={colors.primary} />
        <Text variant="headlineMd" color={colors.onSurface}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        <Icon name={icon} size={18} color={colors.onSurfaceVariant} />
        <Text variant="bodyMd" color={colors.onSurfaceVariant}>{label}</Text>
      </View>
      <Text variant="labelLg" color={colors.onSurface}>{value}</Text>
    </View>
  );
}

/** Renders an ordered list of flow steps; recurses for `if` branches. */
function FlowSteps({ steps }: { steps: Step[] }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {steps.map((step, index) => (
        <StepRow key={index} step={step} index={index} />
      ))}
    </View>
  );
}

function StepRow({ step, index }: { step: Step; index: number }) {
  // Fall back gracefully for any step type this build doesn't know yet — a
  // missing entry must never crash (white-screen) the whole detail view.
  const meta = STEP_META[step.type] ?? { icon: 'info' as IconName, label: step.type };
  return (
    <View>
      <View style={styles.stepRow}>
        <View style={styles.stepNum}>
          <Text variant="labelMd" color={colors.onSurfaceVariant}>{index + 1}</Text>
        </View>
        <Icon name={meta.icon} size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" color={colors.onSurface}>{meta.label}</Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant}>{stepSummary(step)}</Text>
        </View>
      </View>

      {step.type === 'if' ? (
        <View style={styles.branch}>
          <Text variant="labelMd" color={colors.successFgStrong}>إذا تحقّق الشرط</Text>
          <FlowSteps steps={step.then} />
          {step.else && step.else.length > 0 ? (
            <>
              <Text variant="labelMd" color={colors.error}>غير ذلك</Text>
              <FlowSteps steps={step.else} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SelectorRow({ name, selector }: { name: string; selector: Selector }) {
  return (
    <View style={styles.selectorRow}>
      <View style={styles.selectorTop}>
        <Text variant="labelLg" color={colors.onSurface}>{name}</Text>
        <View style={styles.strategyTag}>
          <Text variant="labelMd" color={colors.onSurfaceVariant}>
            {STRATEGY_LABELS[selector.strategy] ?? selector.strategy}
          </Text>
        </View>
      </View>
      <Text variant="bodySm" color={colors.primary}>{selector.value}</Text>
      {selector.match ? (
        <Text variant="labelMd" color={colors.outline}>
          {MATCH_LABELS[selector.match] ?? selector.match}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainer,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  runCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.md,
    gap: spacing.md,
  },
  runHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.primaryFixed,
  },
  runButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logScroll: {
    maxHeight: 220,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
  },
  logBox: {
    padding: spacing.md,
    gap: spacing.xs + 2,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  logDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    marginTop: 6,
  },
  resultBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  section: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceBright,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  sectionBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branch: {
    marginStart: spacing.md,
    paddingStart: spacing.md,
    borderStartWidth: 2,
    borderStartColor: colors.surfaceContainerHighest,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  selectorRow: {
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  selectorTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strategyTag: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  meta: {
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
});
