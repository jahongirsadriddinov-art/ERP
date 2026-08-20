
  # ERP Dashboard Design

  This is a code bundle for ERP Dashboard Design. The original project is available at https://www.figma.com/design/RdYWtpVwGzWkdW5g2mucJZ/ERP-Dashboard-Design.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Known limitations — GPS background tracking

  Worker GPS tracking (`src/app/useGeoTracker.ts`) sends a location ping on an
  interval while the app is open (foreground tab, or foreground in the
  Android/Tauri wrapper). This is a plain web/PWA limitation, not a bug to fix
  here: browsers do not allow JavaScript `setInterval`/`watchPosition` timers
  to keep running once a tab is fully closed or the OS suspends a backgrounded
  PWA. Genuine background tracking (location updates while the app is closed
  or the phone is locked) would require either:
  - A native wrapper with its own background-location API (e.g. Capacitor's
    `@capacitor/geolocation` combined with a native background-service plugin
    — the web `navigator.geolocation` API used today cannot do this even
    inside Capacitor's WebView), or
  - Service Worker **Periodic Background Sync** — supported only for an
    installed PWA on Chromium-based browsers, with the OS free to throttle or
    skip syncs, so it's not a reliable substitute either.

  Until one of those is built, the honest guarantee is: location updates are
  reliable whenever the worker has the app open and in the foreground.
  