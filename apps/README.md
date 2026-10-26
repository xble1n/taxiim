# TAXI IM apps for Windows, Android and iOS

All three apps are thin shells around the live site, **https://www.taxiim.online**.
They use the same server, Neon database, logins and screens as the browser, so an
update to the website reaches every app without reinstalling. No database
credentials, API keys or admin secrets are inside the apps.

| Platform | Folder | Built by | Output |
|---|---|---|---|
| Windows 10/11 (x64) | `apps/desktop` (Electron) | GitHub Actions `windows-latest` | `TAXI-IM-Setup-1.0.0.exe` (installer), `TAXI-IM-Portable-1.0.0.exe` |
| Android 7+ | `apps/mobile/android` (Capacitor) | GitHub Actions `ubuntu-latest` | `app-debug.apk` (installable), `app-release.apk` + `app-release.aab` (signed when the keystore secret is set) |
| iPhone / iPad (iOS 15+) | `apps/mobile/ios` (Capacitor) | GitHub Actions `macos-15` | unsigned `.xcarchive` (proves it compiles; signing needs an Apple account) |

## Download a build

GitHub → **Actions** → **Native apps** → latest run → **Artifacts** at the bottom.
Run it by hand with **Run workflow**. It also runs on every push that changes `apps/`.

## Windows

Install `TAXI-IM-Setup-*.exe`. Windows SmartScreen warns about an unknown publisher
until the exe is signed with a code-signing certificate (about €70–€400 per year from
Certum, Sectigo, DigiCert …). Click **More info → Run anyway** meanwhile.

Local build on Windows: `cd apps/desktop && npm ci && npm run dist:win` (files land in `release/`).
`npm start` opens the app without packaging.

## Android

`app-debug.apk` installs directly on any phone (allow "Install unknown apps").
For Google Play you need:

1. A Google Play developer account (US$25 once).
2. An upload keystore, created once and kept safe:
   `keytool -genkeypair -v -keystore taxi-im-release.jks -alias taxiim -keyalg RSA -keysize 2048 -validity 10000`
3. GitHub → Settings → Secrets and variables → Actions → add
   `TAXI_IM_KEYSTORE_BASE64` (`base64 -w0 taxi-im-release.jks`), `TAXI_IM_KEYSTORE_PASSWORD`,
   `TAXI_IM_KEY_ALIAS` (`taxiim`), `TAXI_IM_KEY_PASSWORD`.
4. Re-run the workflow and upload `app-release.aab` in the Play Console.

The app asks for location so drivers can share GPS while TAXI IM is open, as in the browser.

## iOS

Apple only signs on macOS. You need an Apple Developer account (US$99/year) and a Mac
(or a cloud Mac service such as Codemagic / Bitrise / Xcode Cloud):

1. `cd apps/mobile && npm ci && npx cap sync ios && npx cap open ios`
2. In Xcode: Signing & Capabilities → choose your Team (bundle id `online.taxiim.app`).
3. Product → Archive → Distribute App → App Store Connect / TestFlight.

Apple review note: apps that only wrap a website can be rejected (guideline 4.2).
For an internal staff tool, TestFlight or Apple Business Manager (custom app) avoid that review path.

## Change the server address

- Windows: `main.cjs` (`APP_URL`, or the `TAXI_IM_URL` environment variable when testing).
- Android/iOS: `apps/mobile/capacitor.config.json` → `server.url`, then `npx cap sync`.

## Icons

`apps/mobile/assets/*` (generated from `public/favicon.svg`); regenerate with `npm run assets` in `apps/mobile`.
`apps/desktop/build/icon.png` is the Windows icon.
