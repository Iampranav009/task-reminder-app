/**
 * Native (Capacitor) bridge for the Android app.
 *
 * Everything here is guarded: on the web build there is no Capacitor
 * runtime, so every function returns false / does nothing and the app keeps
 * working with the browser Notification API + speechSynthesis instead.
 *
 * What native adds (Android APK only):
 * - Scheduled system notifications via @capacitor/local-notifications.
 *   These are delivered by Android's AlarmManager even when the app is
 *   closed, which a PWA cannot guarantee.
 * - Voice still uses the phone's free speech engines: voice capture
 *   uses Web Speech Recognition in the WebView, and speaking uses
 *   Android's own TTS engine via @capacitor-community/text-to-speech
 *   (see speakAloud below) — the Web Speech API does not work
 *   reliably inside an Android WebView. Android does not let a
 *   WebView app speak out loud from a fully closed/killed state
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

/** Current Android notification permission: 'granted' | 'denied' | 'prompt' | null (web/unknown). */
export async function checkNativeNotificationPermission(): Promise<string | null> {
  const ln = await getLocalNotifications();
  if (!ln) return null;
  try {
    const res = await ln.checkPermissions();
    return (res as { display?: string }).display || null;
  } catch {
    return null;
  }
}

/** Send one immediate test notification on Android (no-op on web). */
export async function sendTestNativeNotification(): Promise<boolean> {
  const ln = await getLocalNotifications();
  if (!ln) return false;
  try {
    await ensureChannel();
    await ln.schedule({
      notifications: [{
        id: 999999,
        title: 'Task Reminder — test',
        body: 'Notifications are on. Ultron will remind you here.',
        schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
        channelId: 'task-reminders',
        extra: { kind: 'test-notification' },
      }],
    });
    return true;
  } catch {
    return false;
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

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Microphone permission, the two gates Android needs before the WebView
 * can hear Pranav (see MainActivity.java):
 *  1. App gate — RECORD_AUDIO declared in AndroidManifest.xml and
 *     granted at runtime. Without it Android never lists Microphone in
 *     Settings > Apps > Task Reminder > Permissions.
 *  2. WebView gate — the page's AUDIO_CAPTURE request granted in
 *     WebChromeClient.onPermissionRequest (Capacitor's
 *     BridgeWebChromeClient, subclassed in MainActivity).
 *
 * SpeechRecognition on its own does NOT reliably fire gate 2 in a
 * WebView — it just fails with not-allowed and closes after ~1 second.
 * A short getUserMedia({ audio: true }) warm-up DOES fire it, so
 * requestMicrophonePermission() below is called before any
 * SpeechRecognition session starts, and from the Settings button.
 * The stream is stopped immediately; it only exists to trigger the
 * permission prompt.
 */
export async function checkMicrophonePermission(): Promise<MicPermissionState> {
  try {
    const nav = navigator as Navigator & {
      permissions?: { query: (o: { name: string }) => Promise<{ state: string }> };
    };
    if (!nav.permissions?.query) return 'unknown';
    const res = await nav.permissions.query({ name: 'microphone' });
    if (res.state === 'granted' || res.state === 'denied' || res.state === 'prompt') {
      return res.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Trigger the Android mic prompt (via getUserMedia) and return true if granted. */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) return false;
    const stream = await media.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
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

/* ---------- Speech (Listen + Ultron voice) ----------
 *
 * Problem: the Web Speech API does not work reliably inside an
 * Android WebView — speechSynthesis exists, but getVoices() is often
 * empty at first and some devices have no WebView voice at all, so
 * Listen used to show "Speech is not available on this device."
 * Fix: on the native app, speak through Android's own TTS engine via
 * @capacitor-community/text-to-speech (v8, Capacitor 8, auto-
 * registered — no MainActivity change needed). It bypasses the
 * WebView entirely. Web Speech (with async voice loading, see
 * speakWebAsync in core.ts) is only the fallback on the web build.
 * Returns false only when NO engine could speak, so the UI never
 * claims "not available" while a usable voice exists. */
import type { VoiceLang } from './core';

async function getNativeTts() {
  if (!isNativeApp()) return null;
  try {
    const mod = await import('@capacitor-community/text-to-speech');
    return { tts: mod.TextToSpeech, QueueStrategy: mod.QueueStrategy };
  } catch {
    return null;
  }
}

/** Speak text aloud in the chosen language. Native Android TTS first, Web Speech fallback. */
export async function speakAloud(text: string, lang: VoiceLang): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;
  const native = await getNativeTts();
  if (native) {
    const { tts, QueueStrategy } = native;
    try {
      // Prefer the exact language (en-IN / hi-IN / mr-IN); fall back
      // to the base language, then to the device default.
      let useLang = lang;
      try {
        const sup = await tts.isLanguageSupported({ lang });
        if (!sup.supported) {
          const base = await tts.isLanguageSupported({ lang: lang.slice(0, 2) });
          if (base.supported) useLang = lang.slice(0, 2) as VoiceLang;
        }
      } catch { /* language check is best-effort; speak anyway */ }
      await tts.speak({ text: clean, lang: useLang, rate: 1.0, pitch: 1.0, volume: 1.0, category: 'ambient', queueStrategy: QueueStrategy.Flush });
      return true;
    } catch {
      // Native engine failed (e.g. no TTS data installed) — fall through to Web Speech.
    }
  }
  try {
    const core = await import('./core');
    return await core.speakWebAsync(clean, lang);
  } catch {
    return false;
  }
}

/** Stop any speech, native or web. */
export async function stopAloud(): Promise<void> {
  const native = await getNativeTts();
  if (native) { try { await native.tts.stop(); } catch { /* ignore */ } }
  try {
    const core = await import('./core');
    core.stopWebSpeaking();
  } catch { /* ignore */ }
}

/** Open the Android screen that installs missing TTS voice data. No-op on web. */
export async function openTtsInstall(): Promise<boolean> {
  const native = await getNativeTts();
  if (!native) return false;
  try { await native.tts.openInstall(); return true; } catch { return false; }
}

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
