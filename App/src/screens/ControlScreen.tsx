import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '../components/Text';
import {
  AutomationCard,
  type AutomationStatus,
  type IconTone,
} from '../components/AutomationCard';
import type { IconName } from '../components/Icon';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { useEngine } from '../automation/EngineController';
import { useDeviceApp } from '../state/DeviceAppContext';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

// Presentation only — icon + colour tone per platform slug. The behavioural
// config (parameters, selectors, enabled) all comes from the automation config.
const PLATFORM_VISUALS: Record<string, { icon: IconName; tone: IconTone }> = {
  toters:      { icon: 'two_wheeler',     tone: 'primary'   },
  toters_menu: { icon: 'tune',            tone: 'tertiary'  },
  talabat:     { icon: 'delivery_dining', tone: 'tertiary'  },
  baly:        { icon: 'directions_car',  tone: 'secondary' },
  foodics:     { icon: 'point_of_sale',   tone: 'primary'   },
};

const FALLBACK_VISUAL: { icon: IconName; tone: IconTone } = {
  icon: 'smart_toy',
  tone: 'secondary',
};

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ControlScreen() {
  const { config, reload } = useAutomationConfig();
  const engine = useEngine();
  const { selectedApp } = useDeviceApp();
  const navigation = useNavigation<Nav>();

  // Pull-to-refresh re-fetches the automation config from the backend; engine
  // state is already live via context.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload().finally(() => setRefreshing(false));
  }, [reload]);

  // This device runs only the tasks of its chosen delivery app.
  const tasks = selectedApp
    ? config.platforms.filter((p) => p.targetPackage === selectedApp)
    : [];

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
        <Text variant="displayMd" color={colors.onSurface}>لوحة التحكم</Text>
        <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xs }}>
          مراقبة وإدارة تدفقات استخراج البيانات
        </Text>
      </View>

      {!selectedApp ? (
        <View style={styles.emptyState}>
          <Text variant="bodyLg" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            لم يتم اختيار تطبيق لهذا الجهاز بعد.
          </Text>
          <Text variant="bodySm" color={colors.onSurfaceVariant} style={{ textAlign: 'center', marginTop: spacing.sm }}>
            افتح القائمة ← إعدادات لاختيار التطبيق.
          </Text>
        </View>
      ) : null}

      <View style={styles.grid}>
        {tasks.map((p) => {
          const visual = PLATFORM_VISUALS[p.platform] ?? FALLBACK_VISUAL;
          const engineState = engine.stateOf(p.platform);
          const status: AutomationStatus =
            engineState.status === 'running'
              ? 'extracting'
              : engineState.status === 'error'
                ? 'error'
                : 'idle';
          const meta =
            engineState.status === 'paused'
              ? 'متوقّف مؤقتاً'
              : engineState.status === 'running' && engineState.iterationCount > 0
                ? `${engineState.iterationCount} دورة`
                : engineState.status === 'error' && engineState.lastError
                  ? engineState.lastError
                  : undefined;
          return (
            <View key={p.platform} style={styles.gridItem}>
              <AutomationCard
                name={p.label}
                icon={visual.icon}
                iconTone={visual.tone}
                status={status}
                enabled={p.enabled}
                meta={meta}
                onPress={() => navigation.navigate('ConfigDetail', { platform: p.platform })}
              />
            </View>
          );
        })}
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
  emptyState: {
    paddingVertical: spacing.xl2,
    paddingHorizontal: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.sm,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
});
