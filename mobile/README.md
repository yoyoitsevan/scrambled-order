# Scrambled Order for iOS and Android

The apps are [Capacitor](https://capacitorjs.com) shells around the same web client that the website
serves (`index.html`, `css/`, `js/`, `assets/`, `data/` at the repo root). There is one codebase: a
fix to the game is a fix to the website and both apps.

* **App id:** `com.yoyoitsevan.scrambledorder`, **name:** Scrambled Order, portrait (iPad: any orientation).
* **Solo** runs fully offline from files bundled in the app.
* **Multiplayer** connects to `wss://scrambled-order.onrender.com/ws` (see `js/net.js`; in a browser it
  stays same-origin). Room share links point to https://scrambled-order.onrender.com/?room=CODE.
* **Keyboard and safe areas:** the stage is fitted inside the safe areas and above the on-screen keyboard
  (iOS `Keyboard.resize = native`, Android `adjustResize` + the keyboard-height event as a fallback).
* **Icons and splash** are new art (`assets/src/*.svg`, rendered by `assets/render.py`, then
  `npm run assets`). No classic/original files are ever copied: `scripts/copy-web.js` only copies the
  public web files into `www/`.

## Build

Requires Node 22+.

```bash
cd mobile
npm ci
npm run build              # copy the web client into www/
npx cap sync               # copy www/ + plugins into android/ and ios/
# Android (JDK 21 + Android SDK 36):  cd android && ./gradlew assembleDebug
# iOS (macOS + Xcode 26):              npx cap open ios
```

CI: `.github/workflows/android.yml` builds a debug APK artifact; `.github/workflows/ios.yml` builds the
app for the iOS Simulator (unsigned) to prove it compiles.

## Publishing

**Google Play** (one-time $25 developer registration):
1. Create a Play Console account (identity verification; new personal accounts must run a closed test
   with at least 12 testers for 14 days before production access).
2. Create an upload keystore, add a `release` signing config, build `./gradlew bundleRelease` (.aab).
3. Create the app listing: description, screenshots, 512px icon, 1024x500 feature graphic, privacy
   policy URL, content rating questionnaire, data-safety form, target audience.
4. Upload to internal testing, then closed testing, then production. Play App Signing holds the app key.

**Apple App Store / TestFlight** (Apple Developer Program, $99/year):
1. Enroll in the Apple Developer Program (individual, or organization with a D-U-N-S number).
2. Register the bundle id `com.yoyoitsevan.scrambledorder`, create an Apple Distribution certificate and
   an App Store provisioning profile (or let Xcode manage signing), and create the app in App Store Connect.
3. Archive with Xcode 26 on a Mac (or a macOS CI runner with the cert, profile and an App Store Connect
   API key as secrets) and upload. TestFlight internal testers can install right away; external testers
   need a short beta review.
4. For release: screenshots (6.9" iPhone, and iPad because iPad is supported), privacy policy URL,
   privacy "nutrition label", age rating, then submit for review. Apple can reject thin web wrappers
   (guideline 4.2), so native touches such as haptics or Game Center help.
