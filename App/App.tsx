import { I18nManager, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SideMenu } from './src/components/SideMenu';
import { SideMenuProvider } from './src/state/SideMenuContext';
import { AutomationConfigProvider } from './src/automation/AutomationConfigContext';
import { EngineProvider } from './src/automation/EngineController';
import { SessionProvider } from './src/state/SessionContext';
import { DeviceAppProvider } from './src/state/DeviceAppContext';
import { FcmBridge } from './src/components/FcmBridge';
import { colors } from './src/theme';

if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

export default function App() {
  const [fontsLoaded] = useFonts({
    'IBMPlexSansArabic-Regular': IBMPlexSansArabic_400Regular,
    'IBMPlexSansArabic-Medium': IBMPlexSansArabic_500Medium,
    'IBMPlexSansArabic-SemiBold': IBMPlexSansArabic_600SemiBold,
    'IBMPlexSansArabic-Bold': IBMPlexSansArabic_700Bold,
  });
  const navigationRef = useNavigationContainerRef();

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <SessionProvider>
      <FcmBridge />
      <AutomationConfigProvider>
        <DeviceAppProvider>
        <EngineProvider>
          <SideMenuProvider>
            <NavigationContainer ref={navigationRef}>
              <StatusBar style="dark" translucent backgroundColor="transparent" />
              <RootNavigator />
              <SideMenu navigationRef={navigationRef} />
            </NavigationContainer>
          </SideMenuProvider>
        </EngineProvider>
        </DeviceAppProvider>
      </AutomationConfigProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
