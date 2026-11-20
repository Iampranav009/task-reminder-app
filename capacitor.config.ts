import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pranav.taskreminder',
  appName: 'Task Reminder',
  webDir: 'out',
  backgroundColor: '#0b1220',
  android: {
    allowMixedContent: false,
  },
  server: {
    // The app is a fully local static export; no remote server is used.
    cleartext: false,
  },
};

export default config;
