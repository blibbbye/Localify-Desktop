# Localify Desktop

Real Windows desktop build of Localify using Electron.

## Features

- Full current Localify interface and library features.
- Local playback, albums, artists, playlists, likes, search, presets, EQ and compressor.
- Native Discord Rich Presence built into the app.
- Direct Discord IPC connection with automatic reconnect.
- Discord activity shows the current song and artist.
- Discord artwork uses the Localify cover registry and external image URLs.
- `covers.json` is included, and `npm run sync-covers` can populate the local `covers/` folder from the main Localify repo.
- No Localify Discord Connector is required by the desktop app.
- No separate Discord Player is required by the desktop app.
- Normal right-clicks are disabled so the useless Select All popup does not appear. Editable fields keep Cut/Copy/Paste/Select All.
- Windows NSIS installer and portable EXE builds.

## Run

```bash
npm install
npm start
```

## Sync covers

```bash
npm run sync-covers
```

## Build

```bash
npm run sync-covers
npm run build
```

Build output is placed in `dist/`.

## Why Electron

Electron provides Chromium plus a Node.js main process. Localify keeps Node integration out of the page and exposes only the small native bridge needed for desktop functions such as Discord IPC.

Electron 44.5.1 and electron-builder 26.15.3 are used in this repository.
