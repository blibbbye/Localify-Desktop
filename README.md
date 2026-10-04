# Localio Desktop

Real Windows desktop build of Localio using Electron.

## Features

- Full current Localio interface and library features.
- Local playback, albums, artists, playlists, likes, search, presets, EQ and compressor.
- Native Discord Rich Presence built into the app.
- Direct Discord IPC connection with automatic reconnect.
- Discord activity shows the current song and artist.
- Discord artwork uses the Localio cover registry and external image URLs.
- `covers.json` is included, and `npm run sync-covers` populates the local `covers/` folder from the main Localio repo.
- No Localio Discord Connector is required.
- No separate Localio Desktop Player is required.
- Normal right-clicks are disabled; editable fields keep Cut/Copy/Paste/Select All.
- Windows NSIS installer and portable EXE builds.
- Installed NSIS builds automatically check for GitHub releases and download updates in the background.

## Run from source

```bash
npm install
npm run sync-covers
npm start
```

## Build locally

```bash
npm run sync-covers
npm run build
```

Build output is placed in `dist/`.

## Releases and automatic updates

Releases are published from GitHub Actions when a `v*` tag is pushed, for example:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The workflow builds the Windows NSIS installer and portable EXE and publishes the release to the GitHub repository. Installed NSIS versions use `electron-updater` to check the GitHub release feed automatically.

The application version in `package.json` must match the release tag (for example, version `1.0.1` uses tag `v1.0.1`).

Portable EXE builds are provided for convenience but are not the auto-update channel; install the NSIS version for automatic updates.

## Cover system

`npm run sync-covers` downloads the current cover files and `covers.json` from the main Localio repository into:

```text
covers/
covers.json
```

The desktop app can also fall back to the public GitHub cover registry when needed.

## Discord

Discord Desktop must be running. Localio Desktop connects directly through Discord IPC and automatically publishes the current song, artist, timing, and cover artwork.

## Why Electron

Electron provides Chromium plus a Node.js main process. Localio keeps Node integration out of the page and exposes only the small native bridge needed by the desktop app, including Discord IPC and updater functionality.

Electron 44.5.1 and electron-builder 26.15.3 are used in this repository.
