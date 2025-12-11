import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.idofront.app',
  appName: 'IdoFront',
  webDir: 'web-dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    buildOptions: {
      keystorePath: process.env.KEYSTORE_PATH || 'release.keystore',
      keystoreAlias: process.env.KEYSTORE_ALIAS || 'idofront',
      keystorePassword: process.env.KEYSTORE_PASSWORD,
      keystoreAliasPassword: process.env.KEYSTORE_ALIAS_PASSWORD,
      releaseType: 'APK'
    }
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#f9fafb',
      showSpinner: false
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    }
  }
};

export default config;