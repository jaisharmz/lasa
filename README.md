# Läsa

Strava for reading. Kindle and Apple Books already record how far you are in every book. Läsa watches the percent read, turns each rise into a reading session, and puts the sessions in a feed with kudos, comments, follows, streaks, trophies, and a leaderboard for every book. (Läsa is Swedish for "to read", as Strava is Swedish for "to strive".)

The site is https://lasa-reading.web.app. It runs on Firebase: Google sign-in, Firestore for the data, and Hosting for the pages. Anyone with a Google account can sign up, and an admin can switch it to invite-only.

## Use it

1. Open https://lasa-reading.web.app, sign in with Google, and pick a handle.
2. To bring in your whole Kindle history, on any computer, ask Amazon for your Kindle data on its [Request Your Information](https://www.amazon.com/hz/privacy-central/data-requests/preview.html) page. When the email with the download link arrives, which takes a few days to a few weeks, open Settings > Import Kindle history and drop the zip there without unzipping it. Before anything is saved, the page shows how many sessions and books it found, the hours, and the dates they span. New sessions are private unless you untick "Only me".
3. To keep Kindle for Mac and Apple Books syncing as you read, clone this repository on your Mac (Node 22.13 or newer, nothing to install) and run:

```bash
node bin/lasa.mjs login
node bin/lasa.mjs sync
```

`login` opens the site and asks you to connect the Mac. The first `sync` records where every book stands, and reading after that becomes sessions. Paper books go through the Record button, which works on a phone too.

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

## Syncing in the background

```bash
node bin/lasa.mjs agent install
```

`agent install` adds a LaunchAgent that syncs every 10 minutes and logs to `.lasa/sync.log`. `agent uninstall` removes it. macOS can stop a background `node` from reading other apps' containers. If the log says "permission denied", add the path from `which node` under System Settings > Privacy & Security > Full Disk Access.

## Privacy and access

- Only signed-in Google accounts can read anything, and in invite-only mode only invited ones. `firestore.rules` enforces it on the server, and `scripts/check-rules.mjs` tries 23 reads and writes that must succeed or fail.
- Each session can be "Everyone" or "Only me" (Edit on the session). Private sessions are readable only by their reader.
- The Import page saves only sessions and book titles, and new sessions start as "Only me". Books are shared records, so a private import still adds its titles to the shared list of books, without saying who read them.
- Nobody can write a session, kudos, comment, or follow as someone else.
- `.lasa/config.json` on the Mac takes `"hide": ["word", ...]`. A book whose title contains any of those words never becomes a session, like Strava's privacy zones. `"visibility": "private"` makes synced sessions private by default, and highlights stay off until `"shareHighlights": true`.
- The Mac stores its sign-in in `.lasa/credentials.json` (readable only by you). `lasa logout` removes it.

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
