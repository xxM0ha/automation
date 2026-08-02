import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../state/SessionContext';
import { useDeviceApp } from '../state/DeviceAppContext';
import { ControlScreen } from '../screens/ControlScreen';
import { FlowScreen } from '../screens/FlowScreen';
import { SystemScreen } from '../screens/SystemScreen';
import { ConfigDetailScreen } from '../screens/ConfigDetailScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ChooseAppScreen } from '../screens/ChooseAppScreen';
import { TopAppBar } from '../components/TopAppBar';
import { Icon, type IconName } from '../components/Icon';
import { Text } from '../components/Text';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from './types';

type TabKey = 'Control' | 'Flow' | 'System';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_META: Record<TabKey, { label: string; icon: IconName }> = {
  Control: { label: 'التحكم', icon: 'terminal' },
  Flow:    { label: 'التدفق', icon: 'dynamic_feed' },
  System:  { label: 'النظام', icon: 'memory' },
};

/** The persistent app shell: top bar + the three bottom tabs. */
function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopAppBar />
      <Tab.Navigator
        tabBar={(props) => <BottomTabBar {...props} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
      >
        <Tab.Screen name="Control" component={ControlScreen} />
        <Tab.Screen name="Flow" component={FlowScreen} />
        <Tab.Screen name="System" component={SystemScreen} />
      </Tab.Navigator>
    </View>
  );
}

/** Root native-stack, gated in three states with SEPARATE navigators so a route
 * never "sticks" across an auth/onboarding transition:
 *   • signed out          → Login
 *   • signed in, no app   → ChooseApp (picking one resets to Tabs)
 *   • signed in, app set  → Tabs (+ ConfigDetail, + ChooseApp to change it) */
export function RootNavigator() {
  const { session, loading: sessionLoading } = useSession();
  const { selectedApp, loading: appLoading } = useDeviceApp();

  if (sessionLoading || (session && appLoading)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.onSurface} />
      </View>
    );
  }

  if (!session) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={selectedApp ? 'Tabs' : 'ChooseApp'}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="Tabs" component={TabsLayout} />
      <Stack.Screen name="ChooseApp" component={ChooseAppScreen} />
      <Stack.Screen name="ConfigDetail" component={ConfigDetailScreen} />
    </Stack.Navigator>
  );
}

function BottomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom + spacing.sm }]}>
      {state.routes.map((route: any, index: number) => {
        const focused = state.index === index;
        const meta = TAB_META[route.name as TabKey];
        const color = focused ? colors.onSurface : colors.slate400;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={[styles.tabItem, focused && styles.tabItemActive]}
          >
            <Icon name={meta.icon} size={24} color={color} />
            <Text variant="labelMd" color={color} style={styles.tabLabel}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.slate200,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    width: 80,
  },
  tabItemActive: {
    backgroundColor: colors.tabActiveBg,
  },
  tabLabel: {
    marginTop: 4,
  },
});
