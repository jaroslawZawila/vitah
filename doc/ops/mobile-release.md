# Mobile app: releases, over-the-air updates and client errors

How the client app (`apps/mobile`, Expo SDK 57) gets to phones, what can be fixed without a store
release, and where to look when it breaks. Written 2026-11-14 from the repository; nothing here was run
against EAS, the stores or production. Anything not checked is marked **not verified**.

## 1. How a build is made and submitted today

Everything comes from `apps/mobile/eas.json` and `apps/mobile/app.json`. Builds run on EAS (Expo's
build service) under the Expo account `jaroslaw.zawila`, project id
`19436f4d-bc1c-4362-a4ad-c48623fbbfe4`. There is no CI for the app: builds are started by hand.

| Profile | What it produces | Channel | API it talks to |
|---------|------------------|---------|-----------------|
| `preview` | Internal distribution; Android as an `.apk` to install directly | `preview` | `https://portal.vitah.es` |
| `production` | Store builds; the build number rises by itself (`autoIncrement`, kept on EAS: `appVersionSource: "remote"`) | `production` | `https://portal.vitah.es` |

There is no `development` profile and `expo-dev-client` is not installed, so `expo start`
(`pnpm exec turbo dev --filter=mobile`) runs the app in Expo Go, where Android has no push
notifications.

From `apps/mobile`, logged in to EAS (`eas-cli` 16 or later):

```bash
eas build --profile preview --platform android        # an .apk for testers
eas build --profile production --platform android     # Play Store build (.aab)
eas build --profile production --platform ios         # App Store build
eas submit --profile production --platform android    # upload the last build to Play
eas submit --profile production --platform ios        # upload to App Store Connect
```

- `submit.production` in `eas.json` is empty, so `eas submit` asks for everything it needs each time
  (the Play service-account key, the App Store Connect app). **Not verified:** whether either store
  listing exists yet, and which credentials EAS already holds.
- The version users see is `version` in `app.json` (`1.1.0`). Raise it by hand for a release with
  native changes (see §2); the build number is EAS's. `1.1.0` added `expo-image-picker` (Garantía's
  photos), a native module: it reaches phones only in a new store build, never as an update to `1.0.0`.
- Both profiles point at production. A build against a local or preview portal needs
  `EXPO_PUBLIC_API_URL` set in a profile of its own.
- Before a release: `pnpm test`, `pnpm exec turbo check-types`, `pnpm exec turbo lint` (the commit gate
  runs them), and `npx expo-doctor` in `apps/mobile`. Today `expo-doctor` passes 20 of 21 checks: the
  one that fails lists Expo packages one patch behind the newest SDK 57 (`expo` 57.0.25 against
  57.0.33, and its companions). `npx expo install --fix` brings them up; that is a native change,
  so do it before a build, not in an update.

## 2. Over-the-air updates (EAS Update)

`expo-updates` was added on 2026-11-14, so **the next store build is the first one that can receive
updates**. Builds made before it cannot: they have no update code inside.

What is configured (`apps/mobile/app.json`):

```json
"runtimeVersion": { "policy": "appVersion" },
"updates": { "url": "https://u.expo.dev/19436f4d-bc1c-4362-a4ad-c48623fbbfe4" }
```

- A build asks that URL for updates on its **channel**, which comes from its build profile
  (`preview` or `production`, already in `eas.json`).
- It only takes an update with the same **runtime version**. With the `appVersion` policy that is the
  app's `version` (`1.1.0` today, on both platforms; the checks below were made at `1.0.0`).
- Defaults are kept: the app checks when it opens, downloads in the background and runs the update
  the next time it is opened. So a fix reaches a phone after **up to two cold starts** (fully closed
  and reopened, not just sent to the background).

**Checked here:** the dependency installs with the lockfile, `npx expo config --type introspect` writes
the URL and runtime version `1.0.0` into both native configurations, `npx expo-updates
runtimeversion:resolve` gives `1.0.0` for both platforms, `npx expo export --platform android` bundles
the app, `expo-doctor` reports nothing new, and the app's tests pass.

**Not verified** (needs an EAS login, which this work did not have): `eas update:configure` was not run
(the configuration above was written by hand to match what it documents), no build has been made with
it, no update has been published or received, and the app has not been opened in Expo Go since the
change (the development server now sends runtime version `1.0.0` instead of the SDK's). First time
round:

1. `eas update:configure` in `apps/mobile` and check it changes nothing (or review what it changes).
2. `eas build --profile preview --platform android`, install it.
3. Change a visible text, then
   `eas update --channel preview --environment preview --message "test"` (**not verified:** which EAS
   environments exist for this project; `eas update --help` lists the flags).
4. Close the app fully and open it twice: the text changes.

Only then rely on it for production: `eas update --channel production --environment production --message "…"`.

### What an update can fix

Anything that is JavaScript or an asset bundled with it: a screen that crashes, a wrong text or
translation, a layout, a calculation, how the app calls the API, images and fonts loaded from JS.

### What it cannot

- Anything native: a new or upgraded native library (any `expo-*` or `react-native-*` package), an
  Expo SDK upgrade, permissions, the icon, the app name, the bundle id, `google-services.json`,
  config plugins, anything else in `app.json` that ends up in the native project.
- A crash before JavaScript starts, or a native crash.
- A phone that never opens the app online, or a build from before `expo-updates`.

### The rule that keeps updates safe

With `appVersion`, **the team decides when an update is compatible**: raise `version` in `app.json`
in the same change as any native change, and make a new build. If a native change ships without a
new `version`, an update built from that code would be offered to older builds that lack the native
part, and crash them. (`expo-updates` is documented to fall back to the build's own code when an
update crashes on start, not when it crashes later; **not verified** here.)

Why `appVersion` and not `fingerprint`: `fingerprint` works the compatibility out by itself, by
hashing everything native, which is safer against that mistake but changes with every native detail
(a patch upgrade, a plugin option) and has to come out the same on EAS as on the machine that
publishes; in a pnpm monorepo that could not be checked here. `appVersion` is one number a person can
read: "builds 1.0.0 get updates for 1.0.0". Moving to `fingerprint` later is a config change plus a
new build.

## 3. Client errors in the portal's logs

The app reports its own failures to the portal: `POST /api/mobile/client-error`
(`apps/web/app/api/mobile/client-error/route.ts`). The portal writes **one JSON log line** per report
and stores nothing in the database. No third-party service is involved.

To read them: the portal's runtime logs on Vercel (dashboard → the project → Logs, or
`npx vercel logs` from a linked checkout), searching for `mobile.client_error`. **Not verified:** how
long the plan keeps runtime logs; older errors are gone once it drops them.

```json
{
  "level": "error",
  "time": "2026-11-14T10:32:07.412Z",
  "event": "mobile.client_error",
  "message": "TypeError: Cannot read property 'hitos' of undefined",
  "stack": "TypeError: Cannot read property 'hitos' of undefined\n    at PagoScreen (address at index.android.bundle:1:812345)",
  "screen": "/(app)/obra/pago/[id]",
  "fatal": true,
  "appVersion": "1.0.0+1a2b3c4d",
  "platform": "android",
  "osVersion": "35",
  "locale": "es-ES",
  "authenticated": true,
  "userId": "…",
  "tenantId": "…"
}
```

| Field | Meaning |
|-------|---------|
| `event` | Always `mobile.client_error` |
| `message` | The error's name and message (≤ 300 characters from the app, ≤ 500 accepted) |
| `stack` | The first lines of the stack (8 from the app, 12 accepted). From a store build these are positions in the compiled bundle, not file names: reading them needs that build's source map (**not verified:** whether EAS keeps it for our builds) |
| `stack2`, `stack3`… | The rest of a long stack. The portal's logger (`@repo/core/log`) keeps 500 characters of a field, so a stack over that goes on here, whole lines in each; read them in order |
| `screen` | The route's name with its placeholders (`[id]`), never the id |
| `fatal` | `true`: the app could not go on. Either it closed, or the client saw the "Algo no ha ido bien" screen. `false`: something failed in the background and the app carried on |
| `appVersion` | `version` from `app.json`; `+` and the first 8 characters of the update id when the code running came over the air |
| `platform`, `osVersion`, `locale` | `android` / `ios`, the OS version (Android: API level), the phone's locale |
| `authenticated`, `userId`, `tenantId` | Whose phone, when it was signed in with a session still valid. A crash signed out, or with an expired session, is logged all the same with `authenticated: false` |

What the app reports, and when:

- A screen that throws while rendering: the root error boundary (`components/error-fallback.tsx`)
  shows "Algo no ha ido bien" with "Reintentar" and reports it (`fatal: true`).
- An error nothing catches outside rendering (`ErrorUtils` global handler, `lib/global-errors.ts`):
  `fatal` as React Native says. A fatal one is held for up to 1.5 s so the report can leave before
  the app closes; with no connection at that moment the report is lost.
- A promise rejected with nobody listening (`fatal: false`), in builds only.
- A text key the app has no text for, e.g. a status a newer server sends
  (`Missing translation: hitoStatus.…`, `fatal: false`): the sign that the app needs an update.

What limits it:

- Each error is reported once per app session, 5 reports a minute at most, each given 5 s.
- Nothing is sent in development, in Expo Go or in tests, unless the app is started with
  `EXPO_PUBLIC_REPORT_ERRORS=1`.
- Never sent: the email, project data, or the token inside the report (the token only travels as
  the request's `Authorization` header, like every other call). Emails and tokens found in an error's
  text are replaced by `[email]` / `[token]` on the phone and again on the server. A thrown value that
  is not an `Error` is reported by its type only.
- The server accepts bodies up to 8 KB (413 beyond), ignores unknown fields, and limits each IP to 10
  reports a minute and each server instance to 300. The limit lives in the instance's memory, so it
  is best effort: several instances each count on their own. A limited report still gets `204` and
  is dropped without a trace.
- **Native crashes are not reported** (the app dies before JavaScript can say anything). Those show
  in Play Console (Android vitals) and in App Store Connect / TestFlight crash reports.
- Failed API calls are not reported either: the app shows its own message (no connection, timeout,
  server error) and the portal already logs its own 5xx.

## 4. Help and privacy pages (build settings)

Perfil shows "Ayuda y preguntas frecuentes" and "Privacidad y datos" (`A-Settings.dc.html`) only when
the build says where those pages are. Each opens in the phone's browser. A row whose address is not
set, or not `https://`, is left out (`apps/mobile/constants/links.ts`).

| Variable | Row in Perfil |
|----------|---------------|
| `EXPO_PUBLIC_HELP_URL` | Ayuda y preguntas frecuentes |
| `EXPO_PUBLIC_PRIVACY_URL` | Privacidad y datos (the privacy policy the stores ask for) |

Set them in each build profile's `env` in `apps/mobile/eas.json`, next to `EXPO_PUBLIC_API_URL`:

```json
"production": {
  "channel": "production",
  "autoIncrement": true,
  "env": {
    "EXPO_PUBLIC_API_URL": "https://portal.vitah.es",
    "EXPO_PUBLIC_PRIVACY_URL": "https://…",
    "EXPO_PUBLIC_HELP_URL": "https://…"
  }
}
```

Expo writes `EXPO_PUBLIC_*` values into the JavaScript bundle when it is built, so a change reaches
phones with the next build **or** the next update published with the same values (`eas update`
reads the profile's environment; **not verified** how this project's EAS environments are set up, so
check the value in the published update). For `expo start`, put them in `apps/mobile/.env`
(`.env.example`). The pages and their text are the owner's; the repository holds no URL for them.

## 5. Offline copies and device backups

The app keeps an offline copy of each document PDF (and of the list) to open them without a
connection (`apps/mobile/lib/document-store.ts`); acta and invoice PDFs opened from Obra are
downloaded on each open (`lib/hito-files.ts`). Both sit in the app's **cache directory**:

- **iOS:** `Library/Caches` is never in iCloud or computer backups. The OS may empty it when the
  phone runs short of space (never while the app is running); the app downloads the documents again
  on its next sync (opening the app, coming back to it, pulling to refresh).
- **Android:** the cache directory is never in Auto Backup nor in a device-to-device transfer.
  Besides, `expo-secure-store`'s config plugin already limits Auto Backup to shared preferences
  (without its own `SecureStore` file), so files were never in Android backups.

Builds before this change kept the copies in the document directory, which iOS backs up. The first
run of the new code moves them to the cache (or drops them and downloads them again); nothing else
to do. This is JavaScript only: it can ship in an update, no new build needed.

`android.allowBackup: false` in `app.json` was **not** set: the files are already out of Android's
backups, and turning backup off would also drop what the plugin keeps on purpose (other shared
preferences) for nothing in return. It would be a native change (new build, raise `version`).

## 6. Open items for the owner

1. **Privacy policy URL.** Both stores ask for one. Perfil links to it once
   `EXPO_PUBLIC_PRIVACY_URL` is set (§4); the policy's text is the owner's. It should mention that
   the app sends error reports (what broke, the screen, app and OS version, phone locale, and the
   account when signed in) to ViTAH's own servers, and how to ask for the account to be deleted
   (Perfil › "Solicitar la baja de mi cuenta": the builder is told and handles it; nothing is erased
   on its own). The help page (`EXPO_PUBLIC_HELP_URL`) is optional.
2. **Bundle id mismatch, to decide before the first store registration.** `app.json` has iOS
   `bundleIdentifier` `vitah.app` and Android `package` `app.vitah`. Either can never change once an
   app is registered in its store. Where each is used in the repository:
   - `app.vitah`: `apps/mobile/app.json` (`android.package`), `apps/mobile/google-services.json`
     (`client_info.android_client_info.package_name`, Firebase project `vitah-es`), and the API key
     restriction noted in `.github/.gitleaksignore` (Android app `app.vitah` in Google Cloud).
   - `vitah.app`: `apps/mobile/app.json` (`ios.bundleIdentifier`) only. No `GoogleService-Info.plist`,
     no APNs key and no App Store Connect app in the repository (`eas.json`'s `submit.production` is
     empty), so nothing else ties iOS to it yet; **not verified** what EAS or Apple already hold.
   - Neither appears in `eas.json` or the code.
   So the cheaper alignment is iOS → `app.vitah`. Not changed here.
3. **iOS push.** An APNs key has to be uploaded to EAS (`eas credentials -p ios`); until then iOS
   builds get no push notifications. Android sends through Firebase project `vitah-es`.
   **Not verified:** what EAS holds today.
4. **Android store assets.** `doc/app-store/` has the 1024 px icon, the 512 px Play icon and five
   6.9" iPhone screenshots. Missing for Google Play: phone screenshots and the 1024 × 500 feature
   graphic; the listing texts (both stores) are not in the repository.
5. **First OTA check**, §2 steps 1–4, before promising anyone a fix "without a store release".
6. **Expo patch upgrades** (`npx expo install --fix`, §1) before the next store build.
