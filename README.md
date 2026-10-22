# Läsa

Strava for reading. Kindle and Apple Books already record how far you are in every book. Läsa watches the percent read, turns each rise into a reading session, and puts the sessions in a feed with kudos, comments, follows, streaks, trophies, and a leaderboard for every book. (Läsa is Swedish for "to read", as Strava is Swedish for "to strive".)

The site is https://lasa-reading.web.app. It runs on Firebase: Google sign-in, Firestore for the data, and Hosting for the pages. Anyone with a Google account can sign up, and an admin can switch it to invite-only.

## Use it

1. Open https://lasa-reading.web.app, sign in with Google, and pick a handle.
2. To bring in your whole Kindle history, on any computer, ask Amazon for your Kindle data on its [Request Your Information](https://www.amazon.com/hz/privacy-central/data-requests/preview.html) page. When the email with the download link arrives, which takes a few days to a few weeks, open Settings > Import Kindle history and drop the zip there without unzipping it. Before anything is saved, the page shows how many sessions and books it found, the hours, and the dates they span. New sessions are private unless you untick "Only me".
3. To keep Kindle for Mac and Apple Books syncing as you read, use [Läsa for Mac](#läsa-for-mac), a menu-bar app that needs no terminal. The same sync also runs from a clone of this repository (Node 22.13 or newer, nothing to install):

```bash
node bin/lasa.mjs login
node bin/lasa.mjs sync
```

`login` opens the site and asks you to connect the Mac. The first `sync` records where every book stands and adds one estimated "Read before Läsa" entry for each Apple Books book you have started, dated when you last opened it. Reading after that becomes sessions. Paper books go through the Record button, which works on a phone too.

## Where sessions come from

| Source | Read from | What it knows |
| --- | --- | --- |
| Apple Books | `~/Library/Containers/com.apple.iBooksX/.../BKLibrary-*.sqlite` | Percent read and when each book was last opened. iPhone and iPad reading arrives here through iCloud. |
| Kindle for Mac | `~/Library/Containers/com.amazon.Lassen/.../BookData.sqlite` and the synced "most recent read" in `ksdk_annotation_v1.db` | Position in each downloaded book, plus the device and time of its newest synced position. |
| Amazon data export | `Kindle.Devices.ReadingSession.csv` in the zip Amazon emails, dropped on the Import page or passed to `lasa import` | Every real session on any Kindle, phone, tablet or computer, with its start, end, milliseconds read, and page turns. |
| Record button, `lasa log` | You | Timer sessions and paper books. |

Sync copies each database before reading it, so the apps' own files are never opened for writing.

A session is a rise in percent read between two syncs, and rises less than 30 minutes apart join into one. The start is the time the book was opened, if it was opened after the previous sync, or else the previous sync, if it ran under 20 minutes earlier. Otherwise the time is estimated from pages read at your usual pace and marked with a "~". Pages are the change in percent times the page count from Open Library.

The Import page and `lasa import` read the export with the same code, `web/lib/kindle-export.mjs`. The page opens the zip, and any zips inside it, in the browser with fflate from jsDelivr, so the file itself never leaves the computer. Sessions on the same book less than 15 minutes apart join into one, and anything under two minutes is dropped. Each session's id is fixed by book and start time (`kx-<asin>-<start>`), so importing a newer export adds the new sessions and lengthens any that grew, and the page leaves your titles, notes and visibility as they were. From a Mac the same import runs in the terminal, but `lasa import` rewrites every session it finds, edits included:

```bash
node bin/lasa.mjs import ~/Downloads/Kindle.zip --dry-run
node bin/lasa.mjs import ~/Downloads/Kindle.zip
```

## Läsa for Mac

A menu-bar app that syncs Kindle for Mac and Apple Books with no terminal. Inside it is the same sync engine as the CLI (`mac/helper.mjs`, built into one executable with Node's single-executable support) and a small Swift app around it.

The first time it opens, a window walks through three steps:

1. **Connect.** The site opens in your browser. Sign in and press Connect. The app keeps the sign-in in your login Keychain.
2. **Allow access.** Kindle and Apple Books keep their data in folders macOS guards, so the first read makes macOS ask whether Läsa may access data from other apps. Choose Allow.
3. **Record where your books stand.** The first sync notes how far you are in every book. Each started Apple Books book gets one estimated "Read before Läsa" entry, dated when you last opened it, rather than a session for every page you ever read. Here you also choose whether new sessions are visible to everyone or only you.

After that it syncs every 10 minutes, when the Mac wakes, and when it starts. The menu shows the last sync and what it found, each app's book count, Sync Now, Open Läsa, who sees new sessions, Open at Login, the sync log, and Disconnect.

If macOS blocks access (the menu says "blocked by macOS"), open System Settings, then Privacy & Security, then Full Disk Access, and switch on Läsa. If Läsa isn't in the list, press + and choose it in Applications. Accept if macOS offers to quit and reopen Läsa, then press Check Again in the Läsa window.

The app keeps its progress snapshots, `config.json` (the same keys as `.lasa/config.json` below) and `sync.log` in `~/Library/Application Support/Läsa`. Disconnect deletes the Keychain item. Don't run the app and `lasa agent` on the same Mac; the menu says so when it finds the agent.

Builds carry an ad-hoc signature for now and no notarization. macOS refuses to open a downloaded copy the first time; after that attempt, System Settings > Privacy & Security shows an Open Anyway button. macOS also ties Full Disk Access and the Keychain item to the exact build, so after an update it may ask for your password once and need access granted again. A Developer ID signature (below) removes all three.

### Build it

```bash
sh mac/build.sh
open mac/build/Läsa.app
```

The build needs Swift (Xcode or the Command Line Tools) and Node. It downloads the official Node binary once into `~/Library/Caches/lasa-build` and checks it against nodejs.org's checksums, because Homebrew's node loads its libraries from `/opt/homebrew` and is built without single-executable support. It writes `mac/build/Läsa.app` and `mac/build/Lasa-<version>.dmg` (about 48 MB).

To run the app against the emulators from the Develop section:

```bash
open --env LASA_EMULATORS=1 mac/build/Läsa.app
```

It then uses its own Keychain item and `~/Library/Application Support/Läsa/emulators`. `LASA_APPLE_BOOKS_DIR` and `LASA_KINDLE_DIR` point sync at other folders, such as test databases, which also keeps macOS from asking for access. `LASA_NO_OPEN=1` writes the connect link to the sync log instead of opening it.

### Sign it for other people

Signing that strangers' Macs trust takes an Apple Developer Program membership ($99 a year).

1. Join the program with the Apple ID that will sign.
2. Make a Developer ID Application certificate: in Keychain Access, choose Certificate Assistant > Request a Certificate From a Certificate Authority and save the request to disk. Upload it at developer.apple.com under Certificates > + > Developer ID Application, then download the certificate and double-click it. `security find-identity -v -p codesigning` should now list `Developer ID Application: Your Name (TEAMID)`.
3. Make an app-specific password at account.apple.com (Sign-In and Security > App-Specific Passwords) and store it once:

```bash
xcrun notarytool store-credentials lasa-notary --apple-id you@example.com --team-id TEAMID
```

4. Build with the certificate. This adds the hardened runtime and secure timestamps, and gives the sync engine the two JIT entitlements in `mac/helper.entitlements` that V8 needs:

```bash
SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" sh mac/build.sh
```

5. Notarize and staple the disk image, then check it:

```bash
xcrun notarytool submit mac/build/Lasa-0.1.0.dmg --keychain-profile lasa-notary --wait
xcrun stapler staple mac/build/Lasa-0.1.0.dmg
spctl --assess --type open --context context:primary-signature -v mac/build/Lasa-0.1.0.dmg
```

`spctl` should answer "accepted, source=Notarized Developer ID". If notarization fails, `xcrun notarytool log <submission id> --keychain-profile lasa-notary` names the file it objected to. The stapled .dmg is what goes on a GitHub Release.

## Syncing in the background from the terminal

```bash
node bin/lasa.mjs agent install
```

`agent install` adds a LaunchAgent that syncs every 10 minutes and logs to `.lasa/sync.log`. `agent uninstall` removes it. macOS can stop a background `node` from reading other apps' containers. If the log says "permission denied", add the path from `which node` under System Settings > Privacy & Security > Full Disk Access.

## Privacy and access

- Only signed-in Google accounts can read anything, and in invite-only mode only invited ones. `firestore.rules` enforces it on the server, and `scripts/check-rules.mjs` tries 23 reads and writes that must succeed or fail.
- Each session can be "Everyone" or "Only me" (Edit on the session). Private sessions are readable only by their reader.
- The Import page saves only sessions and book titles, and new sessions start as "Only me". Books are shared records, so a private import still adds its titles to the shared list of books, without saying who read them.
- Nobody can write a session, kudos, comment, or follow as someone else.
- `.lasa/config.json` on the Mac takes `"hide": ["word", ...]`. A book whose title contains any of those words never becomes a session, like Strava's privacy zones. `"visibility": "private"` makes synced sessions private by default, and highlights stay off until `"shareHighlights": true`. `"catchUp": ["apple-books", "kindle"]` adds Kindle to the one-time "Read before Läsa" entries (Kindle is left out by default because its data export holds the real sessions), and `[]` turns them off. `lasa catch-up [--kindle]` adds them on demand for a Mac that synced before catch-up existed.
- The CLI stores its sign-in in `.lasa/credentials.json` (readable only by you), and `lasa logout` removes it. Läsa for Mac keeps it in the login Keychain and hands it to the sync engine on standard input for each run.

Admins switch between open sign-up and invite-only in Settings > Access, or from a connected Mac:

```bash
node bin/lasa.mjs access invite
node bin/lasa.mjs invite friend@gmail.com
```

## How the data is laid out

| Collection | One document per | Written by |
| --- | --- | --- |
| `users/{uid}` | reader: handle, name, bio, monthly goal | that reader |
| `handles/{handle}` | claimed handle | its reader |
| `logs/{uid}_{yyyy-mm}_{visibility}` | reader, month and visibility, with that month's sessions as a map | that reader |
| `books/{key}` | book, shared by everyone who reads it | any member (title is fixed once created) |
| `kudos`, `comments`, `follows` | one small record each | the person giving it |
| `config/access` | the sign-up mode and invite list (absent means open) | admins |

Sessions sit in monthly documents so loading a year of reading costs a few dozen document reads, which keeps the free plan's 50,000 reads a day far away.

## Develop

```bash
node bin/lasa.mjs demo
```

The demo serves made-up readers on http://localhost:7796 with no account. To run the real app locally against Firebase's emulators (Java required):

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-lasa
node bin/lasa.mjs serve --emulators
node scripts/check-rules.mjs
node --test
```

Open the app at http://127.0.0.1:7797 (not `localhost`, so sign-in stays on one site). To try the Import page there, zip `test/fixtures/kindle-export` and drop the zip on it. `node bin/lasa.mjs deploy` publishes the site and the rules to the `lasa-reading` project.

## Layout

```
bin/lasa.mjs        the CLI
src/sources/        one reader per app: apple-books, kindle-mac, kindle-export
src/sessions.mjs    progress snapshots to sessions
src/sync.mjs        sources and sessions, written through a sink
src/sinks.mjs       where sessions go: Firestore, or a local folder for the demo and tests
src/firebase.mjs    Firestore and token refresh over REST, with no SDK
src/connect.mjs     the 127.0.0.1 page that takes the sign-in from the site, for the CLI and the app
mac/helper.mjs      the sync engine as the app runs it: one JSON event per line, the account on stdin
mac/Sources/        the Swift menu-bar app
mac/build.sh        the single executable, the app bundle, signing, and the .dmg
web/                the site, plain ES modules with no build step
web/lib/            stats, formatting, the Kindle export reader the CLI shares, and the Firebase and demo backends
firestore.rules     who can read and write what
scripts/            the rules check
test/               node --test
```

## Known gaps

- Kindle for Mac only knows books downloaded to the Mac. Reading on a Kindle or a phone appears once the Mac app syncs that book's position, or through the data export.
- Amazon does not document the export's columns, so the names come from other people's exports. The importer accepts several spellings, and the first real import will confirm them. A book whose title is in none of the export's files is listed as "Kindle book" and its ASIN.
- Open Library is searched by title alone for imported books, so a common title can pick up another book's author or cover.
- Amazon counts a Kindle app left open as reading, so an export can hold sessions of ten hours or more. They are imported as they are.
- Apple Books highlights are wired up but untested, because the library this was built against has none.
- The feed's Everyone tab loads every reader's public sessions, which is fine for a small community. Thousands of readers would need the feed to query only the people you follow.
- There are no Windows or Linux sources yet.
- Läsa for Mac is built for Apple silicon only, needs macOS 13 or newer, and has no automatic updates.
