Drinking in the Sun Nottingham — clustered map rebuild

Deploy from main branch and root folder.
Root URL opens landing page.
/app/ opens the app.

Icons already included in the bundle:
- Landing page browser icons: /public/icons/
- App PWA + iPhone home screen icons: /app/public/icons/

Key files:
- /app/public/icons/icon-192.png = PWA icon
- /app/public/icons/icon-512.png = PWA install icon
- /app/public/icons/apple-touch-icon.png = iPhone Add to Home Screen icon
- /public/icons/favicon-32.png and favicon-16.png = browser tab icons
- /app/public/icons/icon-master-1024.png = master source for future exports


March 2026 routing + icon fixes:
- Root URL opens the landing page
- /app/ opens the app
- Home screen label changed from 'Sun Pubs' to 'Drinking in the Sun'
- Added Apple web app title tags for iPhone
- Added a one-time old service worker/cache cleanup script to flush previous cached app versions
