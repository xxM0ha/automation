import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { useSession } from '../state/SessionContext';
import { registerDevice, handleMenuSyncPush } from '../lib/fcm';

/**
 * Renders nothing — it just wires FCM into the running app:
 *   - registers this device's token with the backend whenever a session exists
 *   - handles menuSync pushes that arrive while the app is in the foreground
 *
 * Background/quit pushes are handled by the headless handler in index.ts.
 */
export function FcmBridge() {
  const { session } = useSession();

  // Register the FCM token under the logged-in restaurant.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[fcm] FcmBridge effect — session:', session ? session.restaurant.slug : 'none');
    if (session) registerDevice(session).catch(() => {});
  }, [session]);

  // Foreground menuSync pushes → run the menu task.
  useEffect(() => {
    const unsub = messaging().onMessage(async (msg) => {
      await handleMenuSyncPush(msg.data as any);
    });
    return unsub;
  }, []);

  return null;
}
