/**
 * Native (Capacitor) bridge for the Android app.
 *
 * Everything here is guarded: on the web / PWA build there is no Capacitor
 * runtime, so every function returns false / does nothing and the app keeps
 * working with the browser Notification API + speechSynthesis instead.
 *
 * What native adds (Android APK only):
 * - Scheduled system notifications via @capacitor/local-notifications.
 *   These are delivered by Android's AlarmManager even when the app is
 *   closed, which a PWA cannot guarantee.
 * - Voice still uses the phone's free Web Speech API (speechSynthesis,
 *   en-IN / hi-IN / mr-IN) inside the Android WebView. Android does not
 *   let a WebView app speak out loud from a fully closed/killed state
 *   without a foreground service, so a scheduled notification speaks when
 *   the app is opened (or when the user taps the notification and the
 *   app opens). The notification itself is reliable; the voice plays
 *   when the app is in the foreground.
 */

export function isNativeApp(): boolean {
  try {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export interface NativeReminder {
  id: number;
  title: string;
  body: string;
  /** When the notification should fire. */
  at: Date;
}

async function getLocalNotifications() {
  if (!isNativeApp()) return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications;
  } catch {
    return null;
  }
}

/** Ask Android for notification permission (no-op on web). */
export async function requestNativeNotificationPermission(): Promise<boolean> {
  const ln = await getLocalNotifications();
  if (!ln) return false;
  try {
    const res = await ln.requestPermissions();
    return (res as { display?: string }).display === 'granted';
  } catch {
    return false;
  }
}

async function ensureChannel(): Promise<void> {
  const ln = await getLocalNotifications();
  if (!ln) return;
  try {
    await ln.createChannel({
      id: 'task-reminders',
      name: 'Task reminders',
      description: 'Friendly reminders for tasks, including Ultron voice reminders.',
      importance: 5,
      vibration: true,
    });
  } catch {
    // Channel creation is best-effort; the plugin has a default channel.
  }
}

/**
 * Schedule one system notification on the device.
 * Returns true when it was handed to Android, false on web / on failure.
 */
export async function scheduleNativeReminder(r: NativeReminder): Promise<boolean> {
  const ln = await getLocalNotifications();
  if (!ln) return false;
  try {
    await ensureChannel();
    await ln.schedule({
      notifications: [
        {
          id: r.id,
          title: r.title,
          body: r.body,
          schedule: { at: r.at, allowWhileIdle: true },
          channelId: 'task-reminders',
          extra: { kind: 'task-reminder' },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Replace all device-scheduled reminders with the given list. */
export async function rescheduleNativeReminders(list: NativeReminder[]): Promise<boolean> {
  const ln = await getLocalNotifications();
  if (!ln) return false;
  try {
    await ensureChannel();
    await ln.cancel({ notifications: [{ id: 0 }] }).catch(() => {});
    // Cancel everything previously scheduled by this app, then re-add.
    const pending = await ln.getPending().catch(() => ({ notifications: [] as { id: number }[] }));
    if (pending.notifications.length) {
      await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) }).catch(() => {});
    }
    if (!list.length) return true;
    await ln.schedule({
      notifications: list.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
        channelId: 'task-reminders',
        extra: { kind: 'task-reminder' },
      })),
    });
    return true;
  } catch {
    return false;
  }
}
