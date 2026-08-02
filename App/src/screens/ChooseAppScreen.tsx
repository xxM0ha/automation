import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from '../components/Text';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useSession } from '../state/SessionContext';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import { listApps } from '../lib/deviceApp';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing, radius } from '../theme';

export function ChooseAppScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session, signOut } = useSession();
  const { config, reload } = useAutomationConfig();
  const { selectedApp, selectApp } = useDeviceApp();
  const apps = listApps(config);
  const [picking, setPicking] = useState<string | null>(null);

  const handlePick = async (id: string) => {
    if (picking) return;
    setPicking(id);
    try {
      await selectApp(id);
      // Go straight to the home shell — no app restart needed.
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    } finally {
      setPicking(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Logo height={44} />
        <Text variant="displayMd" color={colors.onSurface} style={{ textAlign: 'center', marginTop: spacing.lg }}>
          تطبيق هذا الجهاز
        </Text>
        <Text
          variant="bodyMd"
          color={colors.onSurfaceVariant}
          style={{ textAlign: 'center', marginTop: spacing.xs }}
        >
          اختر التطبيق الذي سيعمل عليه هذا الجهاز. سيتم تشغيل مهامه فقط.
        </Text>
      </View>

      {apps.length === 0 ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={colors.onSurface} />
          <Text variant="bodyMd" color={colors.onSurfaceVariant} style={{ textAlign: 'center' }}>
            جارٍ تحميل التطبيقات…
          </Text>
          <Pressable onPress={() => reload()} hitSlop={8}>
            <Text variant="labelLg" color={colors.onPrimaryFixedVariant}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {apps.map((a) => {
            const active = selectedApp === a.id;
            const busy = picking === a.id;
            return (
              <Pressable
                key={a.id}
                disabled={!!picking}
                onPress={() => handlePick(a.id)}
                style={({ pressed }) => [
                  styles.appCard,
                  active && styles.appCardActive,
                  pressed && styles.appCardPressed,
                ]}
              >
                <View style={styles.appIcon}>
                  <Icon name="delivery_dining" size={26} color={colors.onPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="labelLg" color={colors.onSurface}>{a.label}</Text>
                  <Text variant="labelMd" color={colors.outline} style={{ marginTop: 2 }}>
                    {a.taskSlugs.length} مهمة
                  </Text>
                </View>
                {busy ? (
                  <ActivityIndicator color={colors.onSurface} />
                ) : (
                  <Icon name="arrow_forward" size={22} color={colors.onSurfaceVariant} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.footer}>
        {session?.email ? (
          <Text variant="labelMd" color={colors.outline} style={{ textAlign: 'center' }}>
            مسجّل الدخول كـ {session.email}
          </Text>
        ) : null}
        <Pressable onPress={() => void signOut()} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text variant="labelLg" color={colors.error} style={{ textAlign: 'center' }}>
            تسجيل الخروج
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl2,
    paddingBottom: spacing.xl3,
    gap: spacing.xl,
  },
  header: {
    alignItems: 'center',
  },
  logoTile: {
    width: 72,
    height: 72,
    borderRadius: radius.lg + spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  list: {
    gap: spacing.md,
  },
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.lg - 2,
  },
  appCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryFixed,
  },
  appCardPressed: {
    opacity: 0.85,
  },
  appIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
});
