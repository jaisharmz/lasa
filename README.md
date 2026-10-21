# Läsa

Strava for reading. Kindle and Apple Books already record how far you are in every book. Läsa watches the percent read, turns each rise into a reading session, and puts the sessions in a feed with kudos, comments, follows, streaks, trophies, and a leaderboard for every book. (Läsa is Swedish for "to read", as Strava is Swedish for "to strive".)

The site is https://lasa-reading.web.app. It runs on Firebase: Google sign-in, Firestore for the data, and Hosting for the pages. Anyone with a Google account can sign up, and an admin can switch it to invite-only.

## Use it

1. Open https://lasa-reading.web.app, sign in with Google, and pick a handle.
2. To sync Kindle for Mac and Apple Books, clone this repository on your Mac (Node 22.13 or newer, nothing to install) and run:

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
| Amazon data export | `Kindle.Devices.ReadingSession.csv` | Every real session, with its start, end, milliseconds read, and page turns. |
| Record button, `lasa log` | You | Timer sessions and paper books. |

Sync copies each database before reading it, so the apps' own files are never opened for writing.

A session is a rise in percent read between two syncs, and rises less than 30 minutes apart join into one. The start is the time the book was opened, if it was opened after the previous sync, or else the previous sync, if it ran under 20 minutes earlier. Otherwise the time is estimated from pages read at your usual pace and marked with a "~". Pages are the change in percent times the page count from Open Library.

To backfill Kindle history, request your Kindle data on Amazon's "Request Your Information" page. When the email arrives (usually a few days), run:

```bash
node bin/lasa.mjs import ~/Downloads/Kindle.zip --dry-run
node bin/lasa.mjs import ~/Downloads/Kindle.zip
```

Session ids are fixed by book and start time, so importing a newer export again only adds what is new.

## Syncing in the background

```bash
node bin/lasa.mjs agent install
```

`agent install` adds a LaunchAgent that syncs every 10 minutes and logs to `.lasa/sync.log`. `agent uninstall` removes it. macOS can stop a background `node` from reading other apps' containers. If the log says "permission denied", add the path from `which node` under System Settings > Privacy & Security > Full Disk Access.

## Privacy and access

- Only signed-in Google accounts can read anything, and in invite-only mode only invited ones. `firestore.rules` enforces it on the server, and `scripts/check-rules.mjs` tries 23 reads and writes that must succeed or fail.
- Each session can be "Everyone" or "Only me" (Edit on the session). Private sessions are readable only by their reader.
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

Open the app at http://127.0.0.1:7797 (not `localhost`, so sign-in stays on one site). `node bin/lasa.mjs deploy` publishes the site and the rules to the `lasa-reading` project.

## Layout

```
bin/lasa.mjs        the CLI
src/sources/        one reader per app: apple-books, kindle-mac, kindle-export
src/sessions.mjs    progress snapshots to sessions
src/sync.mjs        sources and sessions, written through a sink
src/sinks.mjs       where sessions go: Firestore, or a local folder for the demo and tests
src/firebase.mjs    Firestore and token refresh over REST, with no SDK
web/                the site, plain ES modules with no build step
web/lib/            stats, formatting, and the Firebase and demo backends
firestore.rules     who can read and write what
scripts/            the rules check
test/               node --test
```

## Known gaps

- Kindle for Mac only knows books downloaded to the Mac. Reading on a Kindle or a phone appears once the Mac app syncs that book's position, or through the data export.
- Amazon does not document the export's columns, so the names come from other people's exports. The importer accepts several spellings, and the first real import will confirm them.
- Apple Books highlights are wired up but untested, because the library this was built against has none.
- The feed's Everyone tab loads every reader's public sessions, which is fine for a small community. Thousands of readers would need the feed to query only the people you follow.
- There are no Windows or Linux sources yet.
