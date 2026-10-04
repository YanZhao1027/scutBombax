import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.scut.bombax',
  appName: 'SCUT Bombax',
  webDir: 'dist',
  // The WebView is presentation only. Every SCUT request goes through the
  // native ScutApi plugin, so the page never needs to reach the school hosts.
  server: {
    androidScheme: 'https',
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    // No background scheduler of any kind is registered on purpose.
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true
    }
  }
};

export default config;
