# Desktop Buddy 1.0.0

Desktop Buddy is an interactive Windows desktop cat companion. Its orange tabby lives in a transparent, always-on-top window above the taskbar. The app works offline and does not include telemetry or advertising.

## Install on Windows

1. Download `Desktop-Buddy-Setup-1.0.0-x64.exe` from the **v1.0.0 GitHub Release**.
2. Run the installer and complete installation.
3. Launch **Desktop Buddy** from the Start Menu or Desktop shortcut.

The Version 1.0.0 installer is **unsigned**. Windows may show an **Unknown Publisher** or SmartScreen warning. Review the source and release details before deciding whether to run it. Installation does not require Node.js, npm, Codex, or a terminal.

The installer is for Windows x64. It installs per user, creates Start Menu and Desktop shortcuts, and provides a Windows uninstall entry. User settings remain in the user's application-data directory after uninstall.

## What the cat can do

- Sit idle, blink, wave, read, wear headphones, walk, sleep, and wake based on Windows-wide inactivity.
- Walk left or right with a seven-frame cycle and stay within the usable desktop area.
- React happily to a click, show code-drawn bubbles and hearts, and follow a drag.
- Bat and jump around a separate yarn ball. You can drag or throw the ball anywhere in the usable work area; it slows and bounces while the cat chases its live position in two dimensions and returns to play.
- Pause and resume, mute, reset position, change pet size and timing in Settings, or reset settings to defaults.
- Optionally start with Windows. This is **off by default**.

Right-click the cat for the menu. Yarn play ends automatically. Only one Desktop Buddy instance can run at a time.

## Settings and privacy

Installed settings are saved at `%APPDATA%\Desktop Buddy\config.json`. In source development, `config.json` in the project folder holds local preferences and is ignored by Git. The default values are defined in `src/main/settings.js`; **Reset to Defaults** restores them and turns off Start with Windows. Desktop Buddy checks elapsed system idle time without recording keys, clicks, or typed content. It needs no network connection to run.

## Run from source

Prerequisites: Windows x64, Node.js, and npm or pnpm. From the project folder in PowerShell:

```powershell
npm install
npm start
```

If you use pnpm, run `pnpm install` and `pnpm start` instead. The first install downloads development dependencies. For later starts, only `npm start` or `pnpm start` is needed.

## Artwork and pet configuration

`assets/` contains the original PNG artwork. Do not overwrite it. `pets/orange-cat/pet.json` maps filenames, animation timing, frame order, paw contact points, jump anchors, and play settings. Its seven walking frames are `Walk 1.png`, `Walk 1.5.png`, `Walk 2.png`, `Walk 2.5.png`, `Walk 3.png`, `Walk 3.5.png`, and `Walk 4.png`. Sleep and headphones also use their `1.5` midframes. The play and jump frames are cat-only PNGs; `Yarn Ball.png` is a separate object.

The engine reads the pet pack rather than embedding cat filenames throughout the renderer. To adjust an existing animation, edit the relevant frame mapping or timing in `pets/orange-cat/pet.json`. To add another pet pack later, follow that configuration format and supply its own PNGs. The Windows icon in `build/icon.ico` was made from the existing `assets/Idle 1.png` artwork; `build/create-icon.py` documents that process.

## Tests and local build

Automated checks use the project scripts. For example:

```powershell
npm run smoke
npm run smoke:stage5
npm run smoke:stage6
npm run smoke:stage7f
```

Other `smoke:stage*` scripts in `package.json` cover each interaction phase. Local captures and logs go into ignored `test-output/`. `npm run probe:activity` opens a local diagnostic window and uses temporary short AFK thresholds; it does not save those thresholds.

To build a Windows x64 installer locally:

```powershell
npm install
npm run package:win
```

The installer is written to `dist/` and is not committed to Git. The public installer is attached to the GitHub Release. This project does not include code signing or automatic updates.
