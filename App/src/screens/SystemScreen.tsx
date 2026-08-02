import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { EngineStatusCard } from '../components/EngineStatusCard';
import { PermissionItem, type PermissionStatus } from '../components/PermissionItem';
import { NativeDebugCard } from '../components/NativeDebugCard';
import { ScreenDumpCard } from '../components/ScreenDumpCard';
import { useAccessibilityStatus } from '../hooks/useAccessibilityStatus';
import { useEngine } from '../automation/EngineController';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import { useSession } from '../state/SessionContext';
import { colors, spacing, radius } from '../theme';

type Permission = {
  id: string;
  icon: IconName;
  title: string;
  description: string;
  status: PermissionStatus;
};

const INITIAL_PERMISSIONS: Permission[] = [
  {
    id: 'accessibility',
    icon: 'accessibility_new',
    title: 'خدمة الوصول',
    description: 'ضرورية لقراءة محتوى الشاشة وتنفيذ النقرات التلقائية.',
    status: 'granted',
  },
  {
    id: 'battery',
    icon: 'battery_charging_full',
    title: 'وضع البطارية غير المقيد',
    description: 'يمنع النظام من إيقاف العمليات في الخلفية لتوفير الطاقة.',
    status: 'granted',
  },
  {
    id: 'adb',
    icon: 'developer_mode',
    title: 'إعدادات ADB الآمنة',
    description: 'مطلوب لتجاوز القيود الأمنية وتنفيذ أوامر متقدمة بدون روت.',
    status: 'missing',
  },
  {
    id: 'overlay',
    icon: 'layers',
    title: 'الظهور فوق التطبيقات',
    description: 'لعرض واجهة التحكم العائمة وإشعارات الأتمتة.',
    status: 'granted',
  },
];

export function SystemScreen() {
  const {
    enabled: accessibilityEnabled,
    openSettings: openAccessibilitySettings,
    refresh: refreshAccessibility,
  } = useAccessibilityStatus();
  const { stateOf, restart, start } = useEngine();
  const [restarting, setRestarting] = useState(false);
  const { config } = useAutomationConfig();
  const { selectedApp } = useDeviceApp();
  const { session } = useSession();

  // Real engine metrics for this device's tasks (those targeting the chosen app).
  const deviceTasks = config.platforms.filter((p) => p.targetPackage === selectedApp);
  const taskStates = deviceTasks.map((p) => stateOf(p.platform));
  const runningStates = taskStates.filter((s) => s.status === 'running');
  const totalIterations = taskStates.reduce((sum, s) => sum + s.iterationCount, 0);
  const lastError = taskStates.find((s) => s.lastError != null)?.lastError ?? null;
  // Uptime = time since the earliest still-running task started.
  const earliestStart = runningStates.reduce<number | null>((min, s) => {
    if (s.startedAt == null) return min;
    return min == null ? s.startedAt : Math.min(min, s.startedAt);
  }, null);
  const uptimeMinutes =
    earliestStart != null ? Math.max(0, Math.floor((Date.now() - earliestStart) / 60000)) : 0;

  // Engine state is live via context; refresh only re-checks accessibility and
  // shows a brief spinner.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshAccessibility();
    const t = setTimeout(() => setRefreshing(false), 600);
    return () => clearTimeout(t);
  }, [refreshAccessibility]);

  // The accessibility row reflects the real service state; the rest are static
  // until their own native checks are wired up.
  const permissions: Permission[] = INITIAL_PERMISSIONS.map((p) =>
    p.id === 'accessibility'
      ? { ...p, status: accessibilityEnabled ? 'granted' : 'missing' }
      : p,
  );

  const handlePermissionPress = (id: string) => () => {
    if (id === 'accessibility') {
      openAccessibilitySettings();
      return;
    }
    // TODO: bridge the remaining permissions to their settings pages.
    console.log('open settings for', id);
  };

  const handleRestart = () => {
    if (restarting) return;
    const active = deviceTasks.filter((p) => {
      const s = stateOf(p.platform).status;
      return s === 'running' || s === 'paused';
    });
    if (active.length > 0) {
      // Recycle whatever is currently live.
      active.forEach((p) => restart(p.platform));
    } else {
      // Nothing live — (re)start the tasks configured to run on this device.
      deviceTasks
        .filter((p) => p.control === 'running')
        .forEach((p) => start(p.platform, 'native'));
    }
    setRestarting(true);
    setTimeout(() => setRestarting(false), 2500);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <View style={styles.titleBlock}>
        <Text variant="displayLg" color={colors.onSurface}>صحة النظام والتصاريح</Text>
        <Text variant="bodyLg" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
          مراقبة أداء المحرك وإدارة صلاحيات النظام المطلوبة للعمل بكفاءة.
        </Text>
      </View>

      <View style={{ gap: spacing.lg }}>
        <EngineStatusCard
          running={runningStates.length > 0}
          uptimeMinutes={uptimeMinutes}
          totalIterations={totalIterations}
          runningCount={runningStates.length}
          lastError={lastError}
        />

        <View style={styles.actionCard}>
          <View style={styles.actionIconCircle}>
            <Icon name="restart_alt" size={32} color={colors.primary} />
          </View>
          <Text variant="headlineMd" color={colors.onSurface} style={{ marginBottom: spacing.sm, textAlign: 'center' }}>
            تحديث المحرك
          </Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginBottom: spacing.lg }}>
            في حالة مواجهة أي بطء أو عدم استجابة في المهام المجدولة، قم بإعادة تشغيل المحرك الأساسي.
          </Text>
          <Button
            label={restarting ? 'جارٍ إعادة التشغيل…' : 'إعادة تشغيل المحرك'}
            icon="restart_alt"
            fullWidth
            disabled={restarting}
            onPress={handleRestart}
          />
        </View>

        <View style={styles.permsCard}>
          <View style={styles.permsHeader}>
            <View style={styles.permsTitleRow}>
              <Icon name="admin_panel_settings" size={24} color={colors.primary} />
              <Text variant="headlineLg" color={colors.onSurface}>التصاريح المطلوبة</Text>
            </View>
            <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
              تحتاج الأتمتة إلى هذه الصلاحيات للتفاعل مع واجهة النظام بشكل صحيح.
            </Text>
          </View>

          <View style={styles.permsList}>
            {permissions.map((p) => (
              <PermissionItem
                key={p.id}
                icon={p.icon}
                title={p.title}
                description={p.description}
                status={p.status}
                onPress={handlePermissionPress(p.id)}
              />
            ))}
          </View>
        </View>

        {/* Dev-only tools — hidden for restaurant accounts in production. */}
        {session?.isDev && (
          <>
            <ScreenDumpCard />
            <NativeDebugCard />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl3,
  },
  titleBlock: {
    marginBottom: spacing.xl,
  },
  actionCard: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.lg,
    alignItems: 'center',
  },
  actionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  permsCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    overflow: 'hidden',
  },
  permsHeader: {
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerHighest,
    backgroundColor: colors.surfaceBright,
  },
  permsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
  },
  permsList: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
