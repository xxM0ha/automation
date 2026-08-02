import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Modal, Animated, Easing } from 'react-native';
import { useNavigationContainerRef, type NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSideMenu } from '../state/SideMenuContext';
import { useSession } from '../state/SessionContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import { useAutomationConfig } from '../automation/AutomationConfigContext';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { colors, spacing, radius } from '../theme';

const PANEL_WIDTH = 300;
const ANIM_DURATION = 220;

const NAV_ITEMS: { id: string; label: string; icon: IconName; tabRoute: string }[] = [
  { id: 'control', label: 'التحكم', icon: 'terminal',     tabRoute: 'Control' },
  { id: 'flow',    label: 'التدفق', icon: 'dynamic_feed', tabRoute: 'Flow'    },
  { id: 'system',  label: 'النظام', icon: 'memory',       tabRoute: 'System'  },
];

type Props = {
  navigationRef: NavigationContainerRefWithCurrent<any>;
};

export function SideMenu({ navigationRef }: Props) {
  const { isOpen, close } = useSideMenu();
  const { session, signOut } = useSession();
  const { selectedApp } = useDeviceApp();
  const { config } = useAutomationConfig();
  const insets = useSafeAreaInsets();

  const name = session?.restaurant?.name ?? 'غير مسجّل';
  const email = session?.email ?? '';
  const initial = name.trim().charAt(0).toUpperCase();

  // Turn the device's selected package into a friendly app label: prefer the
  // platform whose targetPackage matches and whose slug has no underscore,
  // else the first match.
  const appLabel = (() => {
    if (!selectedApp) return null;
    const matches = config.platforms.filter((p) => p.targetPackage === selectedApp);
    if (matches.length === 0) return null;
    return (matches.find((p) => !p.platform.includes('_')) ?? matches[0]).label;
  })();

  // Local "rendered" state lets us keep the modal mounted during exit animation.
  const [rendered, setRendered] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  // Slide the panel in once the modal is actually on screen (onShow), not at
  // mount time — starting a native animation before the modal window is
  // presented drops the first frames and makes the open look like it jumps.
  const animateIn = useCallback(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: ANIM_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  useEffect(() => {
    if (isOpen) {
      // Mount off-screen; the entrance animation fires from the modal's onShow.
      progress.setValue(0);
      setRendered(true);
    } else if (rendered) {
      Animated.timing(progress, {
        toValue: 0,
        duration: ANIM_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [isOpen, progress, rendered]);

  const navigateTo = (tabRoute: string) => {
    // Navigate first so the route change doesn't depend on the close animation
    // finishing. Tab routes are nested inside the "Tabs" stack screen.
    navigationRef.current?.navigate({ name: 'Tabs', params: { screen: tabRoute } } as never);
    close();
  };

  if (!rendered) return null;

  // The panel is docked with a flex row (not left/right), because forceRTL has
  // doLeftAndRightSwapInRTL on by default — `right: 0` would resolve to the
  // physical LEFT. A row places the single child at the start, which in RTL is
  // the right edge (same mechanism that puts the hamburger on the right). The
  // panel then slides in from that right edge via translateX.
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [PANEL_WIDTH, 0] });

  return (
    <Modal transparent visible={rendered} onRequestClose={close} onShow={animateIn} animationType="none" statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable style={{ flex: 1 }} onPress={close} />
        </Animated.View>

        <View style={styles.panelRow} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_WIDTH,
              transform: [{ translateX }],
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={styles.profile}>
            <View style={styles.avatar}>
              {initial ? (
                <Text variant="headlineMd" color={colors.onSurfaceVariant}>
                  {initial}
                </Text>
              ) : (
                <Icon name="admin_panel_settings" size={28} color={colors.onSurfaceVariant} />
              )}
            </View>
            <Text variant="headlineMd" color={colors.onSurface} style={{ marginTop: spacing.md }}>
              {name}
            </Text>
            {email ? (
              <Text variant="bodySm" color={colors.onSurfaceVariant}>
                {email}
              </Text>
            ) : null}
            {session && appLabel ? (
              <View style={styles.appBadge}>
                <Text variant="labelMd" color={colors.onSurfaceVariant}>
                  {appLabel}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            {NAV_ITEMS.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => navigateTo(item.tabRoute)}
                style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
              >
                <Icon name={item.icon} size={22} color={colors.slate500} />
                <Text variant="labelLg" color={colors.onSurface}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.divider} />

          <View style={styles.section}>
            <Pressable
              onPress={() => {
                // Navigate first so opening the screen doesn't hinge on the
                // close/modal-dismiss animation timing.
                navigationRef.current?.navigate('ChooseApp' as never);
                close();
              }}
              style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
            >
              <Icon name="delivery_dining" size={22} color={colors.slate500} />
              <Text variant="labelLg" color={colors.onSurface}>تطبيق هذا الجهاز</Text>
            </Pressable>
          </View>

          <View style={{ flex: 1 }} />

          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                void signOut();
                close();
              }}
              style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
            >
              <Icon name="power_settings_new" size={22} color={colors.error} />
              <Text variant="labelLg" color={colors.error}>تسجيل الخروج</Text>
            </Pressable>
          </View>
        </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  panelRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  panel: {
    backgroundColor: colors.surfaceContainerLowest,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: -4, height: 0 },
    elevation: 16,
  },
  profile: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHighest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  appBadge: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerHighest,
    marginHorizontal: spacing.md,
  },
  section: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    borderRadius: radius.lg,
  },
  navItemPressed: {
    backgroundColor: colors.surfaceContainerLow,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
});

// Helper for App.tsx to create the nav ref.
export { useNavigationContainerRef };
