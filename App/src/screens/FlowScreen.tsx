import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/Text';
import { Icon } from '../components/Icon';
import { LivePing } from '../components/LivePing';
import { EventRow, type EventStatus } from '../components/EventRow';
import { useEngine } from '../automation/EngineController';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import type { RunLogEntry } from '../automation/interpreter';
import { colors, spacing, radius } from '../theme';

/** Max events shown in the log card. */
const MAX_EVENTS = 50;

type FlowEvent = {
  id: string;
  ts: number;
  time: string;
  title: string;
  description: string;
  status: EventStatus;
};

/** Map an engine log level onto the EventRow status vocabulary. */
function levelToStatus(level: RunLogEntry['level']): EventStatus {
  switch (level) {
    case 'success':
      return 'success';
    case 'error':
      return 'failure';
    case 'step':
      return 'processing';
    default:
      return 'info';
  }
}

/** Format an epoch-ms timestamp as HH:MM:SS. */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function FlowScreen() {
  const engine = useEngine();
  const { config, reload } = useAutomationConfig();
  const { selectedApp } = useDeviceApp();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    // Engine state is already live via context; this just re-reads the config
    // and gives the user a brief visual confirmation.
    setRefreshing(true);
    reload();
    const t = setTimeout(() => setRefreshing(false), 600);
    return () => clearTimeout(t);
  }, [reload]);

  // The tasks that belong to THIS device's chosen app.
  const tasks = useMemo(
    () =>
      selectedApp
        ? config.platforms.filter((p) => p.targetPackage === selectedApp)
        : [],
    [config, selectedApp],
  );

  // Aggregate the live engine state for those tasks.
  const states = useMemo(
    () => tasks.map((t) => ({ task: t, state: engine.stateOf(t.platform) })),
    [tasks, engine],
  );

  // Flatten the per-task logs into a single, newest-first event list.
  const events = useMemo<FlowEvent[]>(() => {
    const all: FlowEvent[] = [];
    for (const { task, state } of states) {
      for (const entry of state.log) {
        all.push({
          id: `${task.platform}:${entry.id}`,
          ts: entry.ts,
          time: formatTime(entry.ts),
          title: entry.message,
          description: task.label ?? '',
          status: levelToStatus(entry.level),
        });
      }
    }
    // Newest first across all tasks, capped to the most recent MAX_EVENTS.
    return all.sort((a, b) => b.ts - a.ts).slice(0, MAX_EVENTS);
  }, [states]);

  // Real stats across the device's tasks.
  const stats = useMemo(() => {
    let totalIterations = 0;
    let runningCount = 0;
    let pausedCount = 0;
    let lastActivity: number | null = null;
    let lastError: string | null = null;
    for (const { state } of states) {
      totalIterations += state.iterationCount;
      if (state.status === 'running') runningCount += 1;
      if (state.status === 'paused') pausedCount += 1;
      if (state.lastError) lastError = state.lastError;
      const tail = state.log[state.log.length - 1];
      if (tail && (lastActivity === null || tail.ts > lastActivity)) {
        lastActivity = tail.ts;
      }
    }
    return {
      totalIterations,
      runningCount,
      pausedCount,
      lastActivity,
      lastError,
      anyRunning: runningCount > 0,
    };
  }, [states]);

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
        <Text variant="headlineLg" color={colors.onSurface}>تدفق الاستخراج المباشر</Text>
        <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: spacing.sm }}>
          مراقبة الأحداث وتدفق البيانات في الوقت الفعلي.
        </Text>
      </View>

      {!selectedApp ? (
        <EmptyState />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <TayfStatusCard anyRunning={stats.anyRunning} lastError={stats.lastError} />
          <StatsSummaryCard
            totalIterations={stats.totalIterations}
            runningCount={stats.runningCount}
            taskCount={tasks.length}
            lastActivity={stats.lastActivity}
            lastError={stats.lastError}
          />
          <EventLogCard events={events} />
        </View>
      )}
    </ScrollView>
  );
}

function EmptyState() {
  return (
    <View style={[styles.smallCard, { flexDirection: 'column', gap: spacing.md, justifyContent: 'center' }]}>
      <View style={styles.tayfIcon}>
        <Icon name="smart_toy" size={24} color={colors.primary} />
      </View>
      <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
        لم يتم اختيار تطبيق لهذا الجهاز
      </Text>
    </View>
  );
}

function TayfStatusCard({ anyRunning, lastError }: { anyRunning: boolean; lastError: string | null }) {
  const subtitle = lastError ? lastError : anyRunning ? 'يعمل' : 'متوقف';
  const iconName = lastError ? 'error' : anyRunning ? 'check_circle' : 'schedule';
  const iconColor = lastError ? colors.error : colors.primary;
  return (
    <View style={styles.smallCard}>
      <View style={styles.tayfLeft}>
        <View style={styles.tayfIcon}>
          <Icon name="smart_toy" size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="labelLg" color={colors.onSurface}>مزامنة Tayf AI</Text>
          <Text variant="bodySm" color={lastError ? colors.error : colors.onSurfaceVariant} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.checkBadge}>
        <Icon name={iconName} size={20} color={iconColor} />
      </View>
    </View>
  );
}

function StatsSummaryCard({
  totalIterations,
  runningCount,
  taskCount,
  lastActivity,
  lastError,
}: {
  totalIterations: number;
  runningCount: number;
  taskCount: number;
  lastActivity: number | null;
  lastError: string | null;
}) {
  return (
    <View style={[styles.smallCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <Text variant="labelLg" color={colors.onSurface} style={{ marginBottom: spacing.md }}>
        إحصائيات التدفق
      </Text>
      <StatRow label="إجمالي الدورات اليوم" value={String(totalIterations)} />
      <StatRow label="المهام النشطة" value={`${runningCount} / ${taskCount}`} />
      <StatRow
        label="آخر نشاط"
        value={lastActivity ? formatTime(lastActivity) : '—'}
      />
      <StatRow
        label="آخر خطأ"
        value={lastError ?? 'لا يوجد'}
        valueColor={lastError ? colors.error : undefined}
        last
      />
    </View>
  );
}

function StatRow({ label, value, valueColor, last }: { label: string; value: string; valueColor?: string; last?: boolean }) {
  return (
    <View
      style={[
        styles.statRow,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.surfaceContainer,
          paddingBottom: spacing.sm,
          marginBottom: spacing.md,
        },
      ]}
    >
      <Text variant="bodySm" color={colors.onSurfaceVariant}>{label}</Text>
      <Text variant="labelMd" color={valueColor ?? colors.onSurface} numberOfLines={1} style={{ flexShrink: 1, textAlign: 'left' }}>
        {value}
      </Text>
    </View>
  );
}

function EventLogCard({ events }: { events: FlowEvent[] }) {
  return (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <Text variant="headlineMd" color={colors.onSurface}>سجل الأحداث</Text>
        <View style={styles.liveLabel}>
          <LivePing size={12} />
          <Text variant="labelMd" color={colors.primary}>مباشر</Text>
        </View>
      </View>

      <View>
        {events.length === 0 ? (
          <View style={styles.emptyLog}>
            <Text variant="bodySm" color={colors.onSurfaceVariant}>لا توجد أحداث بعد</Text>
          </View>
        ) : (
          events.map((e, i) => (
            <EventRow
              key={e.id}
              time={e.time}
              title={e.title}
              description={e.description}
              status={e.status}
              showDivider={i < events.length - 1}
            />
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl3,
  },
  titleBlock: {
    marginBottom: spacing.lg,
  },
  smallCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceVariant,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  tayfLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  tayfIcon: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    backgroundColor: colors.secondaryContainer,
    padding: spacing.sm,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  logCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceVariant,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceVariant,
    backgroundColor: colors.surfaceContainerLow,
  },
  liveLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  emptyLog: {
    padding: spacing.lg,
    alignItems: 'center',
  },
});
