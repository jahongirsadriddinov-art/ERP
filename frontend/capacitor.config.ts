import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uz.erp_firma.qurilisherp',
  appName: 'QurilishERP',
  webDir: 'dist',
  server: {
    // Production da bu comment qilinadi — APK offline bundle'ni ishlatadi.
    // Dev uchun: qurilma va kompyuter bir xil tarmoqda bo'lishi kerak.
    // androidScheme: 'https',
    // url: 'http://192.168.1.X:5173',
    allowNavigation: [
      'qurilisherp-backend.onrender.com',
      'erp-firma.uz',
      'openrelay.metered.ca',
      '*.googleapis.com',
      '*.google.com',
    ],
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
    minWebViewVersion: 80,
    backgroundColor: '#F4F6FA',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1B3A6B',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#1B3A6B',
    },
    Geolocation: {
      // Joylashuv so'rovi faqat davomatni belgilashda ishlatiladi
    },
    Camera: {
      // QR skanerlash uchun
    },
  },
};

export default config;
