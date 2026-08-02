import { registerRootComponent } from 'expo';
import messaging from '@react-native-firebase/messaging';

import App from './App';
import { handleMenuSyncPush } from './src/lib/fcm';

// Headless background/quit handler for FCM data messages. Runs natively even
// when the app is backgrounded or killed — turns a menuSync push into an
// engine run. Must be registered at module scope, before the app mounts.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await handleMenuSyncPush(remoteMessage.data as any);
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
