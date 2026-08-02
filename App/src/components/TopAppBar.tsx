import { View, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSideMenu } from '../state/SideMenuContext';
import { useSession } from '../state/SessionContext';
import { Icon } from './Icon';
import { Text } from './Text';
import { Logo } from './Logo';
import { colors, spacing } from '../theme';

export function TopAppBar() {
  const insets = useSafeAreaInsets();
  const { open } = useSideMenu();
  const { session } = useSession();

  const initial = (session?.restaurant?.name ?? '').trim().charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={open} hitSlop={8} style={styles.iconBtn}>
        <Icon name="menu" size={24} color={colors.slate500} />
      </Pressable>

      <View style={styles.brand}>
        <Logo height={30} />
      </View>

      <View style={styles.avatar}>
        {initial ? (
          <Text variant="labelLg" color={colors.onSurfaceVariant}>
            {initial}
          </Text>
        ) : (
          <Icon name="admin_panel_settings" size={20} color={colors.slate500} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(248, 250, 252, 0.8)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.slate200,
  },
  iconBtn: {
    padding: spacing.sm,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    flex: 1,
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHighest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.slate200,
  },
});
