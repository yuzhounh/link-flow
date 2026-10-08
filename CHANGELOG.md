# Changelog

## 0.3.13 - 2026-10-08

- Settings dialog trimmed to device name (input on the right), auto-save to clipboard and dark mode; descriptions removed.
- Settings dialog and the phone long-press sheet share one style (20px radius, 16px text, line icons); the sheet is vertically centred on the pressed card.
- Windows app and Android APK both 0.3.13 (APK versionCode 12).

## 0.3.12 - 2026-10-08

- Version unified: Windows app and Android APK are both 0.3.12 (APK versionCode 11).
- Received file cards no longer show a status row; "start/received" toasts are removed on Android and receive failures are shown on the card.
- Phone: long-press a text or file card for a rounded action sheet (copy / select text / delete, or copy link / re-receive / receive thumbnail / delete); a tap shows nothing. Hover-only action bars no longer stick on touch screens.
- Switching between month browsing and live messages no longer shows a toast; a new message while browsing another month says "有新消息，请返回实时消息查看".
- Toasts share one rounded style in the web UI and the APK: light blue for info, light red for errors.

## Unreleased

- 0.3.5 mobile: compact cards, fit-to-screen image previews, gallery photo picker, original download filenames and Android system open/install flow; host-only QR pairing and client connection management. APK MIME is explicit rather than generic binary.

- Paste preserves original file names and extensions. Raw clipboard images without an original file name use `Image_<timestamp>`, with an explicit encoding-to-extension mapping. On the Windows host, file-drop metadata takes priority over duplicate bitmap representations; when metadata is unavailable, existing names are preserved. Image compression rules are unchanged.

- Uploaded photos (JPG/PNG/BMP over 300 KB) also get a compressed JPEG copy (long edge up to 1920 px, quality 80, EXIF rotation applied) stored in `data/thumbs/`. The original is kept unchanged. The file card shows both, and "复制" copies the compressed image while "复制原图" copies the original.
- Messages now show the sending device's name (for example "iPad" or the PC's name) instead of a generic "手机"/"电脑". Names are guessed automatically and can be changed in settings.
- Two new nullable-by-default columns (`thumb_size`, `device_name`) are added to existing databases automatically.

## 0.3.1 - 2026-10-03

- Roll back only the file moved by the current upload when database registration fails. Existing files with the same name are preserved, and retrying does not leave an orphan from the failed attempt.
- Add an offline regression runner using the real upload handler and an isolated SQLite database: successful upload, rejected insert, same-name collision and retry.
- Existing messages, file layout and pairing configuration are unchanged.

## 0.3.0 - 2026-09-27

Rewritten as a native Windows application. The web UI (`static/`) and the data layout (`data/`) are unchanged, so existing messages, files and phone pairings keep working.

### Changed

- Replaced the Python/Tornado/PyQt stack with C# / .NET 10: ASP.NET Core Kestrel for the LAN HTTP/WebSocket server, WebView2 for the main window, WinForms for the window shell and system tray.
- The main window and tray menu render at each monitor's real DPI (Per-Monitor V2), with GDI ClearType text in the tray menu.
- "Reveal in folder" uses the Windows Shell API and reuses an Explorer window already showing that folder.
- The phone connection address prefers the network adapter that has a default gateway.
- Uploads are streamed to disk instead of being buffered in memory.
- Replaced the VBS/BAT launchers and Python scripts with a single `LinkFlow.exe` (`--stop` for a graceful shutdown) and a `build.ps1` build script that creates a desktop shortcut.

### Removed

- The Python implementation (`main.py`, `server/*.py`, `tests/`, launch scripts). It remains available in v0.2.2.

## 0.2.2 - 2026-09-27

Final release of the Python/PyQt implementation. Later versions are a native Windows (.NET) rewrite.

### Changed

- The PC client now runs in a standalone desktop window that remembers its size and position; closing it hides LinkFlow to the tray.
- Restyled the tray menu to match native Windows 11 context menus and adjusted its size under High DPI.
- Enlarged the phone and computer avatars, refined scrollbars, and removed the redundant header icon and title.
- Added a brand header and screenshots to the README.

### Fixed

- Adjusted Per-Monitor V2 DPI handling for the main window and tray menu.
- Removed the popup notification shown when the window is closed to the tray.

## 0.2.1 - 2026-09-25

### Fixed

- Prevented newly opened LinkFlow tabs from closing immediately when another tab is hidden.
- Replaced port-based forced termination with a LinkFlow-only graceful shutdown endpoint.
- Added a Windows named mutex and runtime metadata so secondary launches find the actual active port.

### Changed

- Added rotating persistent logs at `data/linkflow.log` and a tray action for opening the log.
- Redesigned the LinkFlow logo as opposing half-arrows and synchronized the tray, shortcut, browser, PWA, and in-app icons.
- Added lifecycle, safe-shutdown, and browser-activation regression tests.

## 0.2.0 - 2026-09-25

### Security

- Added a persistent random pairing token to phone QR codes and LAN API/WebSocket requests.
- Rejected cross-origin API and WebSocket requests.
- Restricted clipboard, settings, wake, and local file operations to the host PC.
- Protected transferred-file downloads with the same pairing token.
- Hardened managed file paths against directory traversal.

### Fixed

- Clearing all history now also removes transferred files and thumbnails.
- Added rollback protection if the database clear fails after files are staged for deletion.
- Limited individual uploads to 256 MB and enforced the request cap at the HTTP server.

### Changed

- Added application version and upload-limit information to the system API and settings panel.
- Removed unused Pillow and PyMuPDF runtime dependencies because previews remain disabled.
- Added pinned runtime dependencies and expanded security/data-cleanup tests.
