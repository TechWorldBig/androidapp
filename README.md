# JSC Bible Quiz

React Native member app, React pastor dashboard, and Firebase backend for JSC Kollemcode Pentecostal Church. This repository is an **implementation starter**, not a deployed APK. Firebase project configuration, a pastor account, device verification, and signing are still required before distribution.

## Setup on Windows

1. Install Node.js 22, Java JDK 17, Android Studio, Firebase CLI, and EAS CLI. In PowerShell where npm scripts are blocked, run `npm.cmd` instead of `npm`.
2. Run `npm.cmd install` in the repository root.
3. Create a Firebase project and enable Email/Password Authentication and Cloud Firestore. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and `apps/admin/.env.example` to `apps/admin/.env`, then fill in the Firebase web app config values. These values are public identifiers, not secrets.
4. Run `firebase login`, `firebase use --add`, and `firebase emulators:start` for local development. Cloud Functions cloud deployment may require the Blaze billing plan; emulator use does not.
5. Run `npm.cmd run build` and `npm.cmd run typecheck`.
6. Run `npm.cmd --workspace apps/admin run dev` for the dashboard. Run `npm.cmd --workspace apps/mobile run start` for the Expo app. Android testing requires a development build or emulator.

## First pastor

Create the pastor account in Firebase Authentication. Set its custom claim with a trusted Firebase Admin SDK script such as `getAuth().setCustomUserClaims(uid, { pastor: true })` from a secure administrator machine. Never expose a client function that can set the pastor claim. Sign out and back in after the claim changes.

## APK for Android

From `apps/mobile`, run:

```text
npm.cmd install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview
```

The preview profile creates an internally distributed APK. Download the signed artifact from the EAS build page. The Android application ID is `org.jsckollemcode.biblequiz`; keep it and the signing key stable for updates. Test the APK on a physical Android device before sharing. Expo SDK 54 targets Android 7.0 or later; confirm the final build's actual minimum SDK before announcing compatibility.

Upload the APK to a controlled Drive folder or use the EAS internal distribution URL. Put that URL into `apps/download/index.html`, deploy that page to Firebase Hosting, then share its URL or QR code through WhatsApp. Recipients may need to allow installation from their browser or file manager. They should install updates only from the same official link.

## Security and current limits

Firestore rules block client writes to quizzes, scores, attempts, roles, and answer keys. Callable functions check auth and pastor claims. Correct answers live outside member-readable collections. Camera consent, face checks, native focus/multi-window monitoring, FCM, CSV import, leaderboard, automatic server submission of unanswered attempts, audit UI, and comprehensive tests are **not yet implemented**. Do not deploy for a real competition until these are completed and independently reviewed.

See `docs/PRIVACY.md` and `docs/DEVICE_TESTS.md`.
