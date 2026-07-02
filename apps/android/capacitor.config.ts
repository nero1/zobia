import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.zobiasocial.app',
  appName: 'Zobia',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#1d4ed8',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#ffffff',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    AdMob: {
      // Real ad unit IDs are read at runtime from x_manifest (ad_admob_*) via
      // GET /api/manifest — see docs/SETUP.md "AdMob (Capacitor Android)"
      // for the native AndroidManifest.xml App ID step required before release.
      requestTrackingAuthorization: true,
      testingDevices: [],
      initializeForTesting: true,
    },
  },
}

export default config
