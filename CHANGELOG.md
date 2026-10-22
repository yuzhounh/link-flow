# Changelog

## 0.4.2 - 2026-10-23 (daily update)

- Month history now loads bounded pages with a timestamp/ID cursor, including records sharing the same millisecond; month search respects its requested limit. Invalid month parameters return 400.
- Loading older records inserts only the new cards and merges the date boundary, preserving existing card state and scroll position. Switching months, returning to all records and starting a search cancel stale pagination; live messages do not leak into unrelated search results.
- The header keeps the full month total while only a page is loaded. Windows, browser and Android share this timeline; existing data, pairing and native download handling remain in place.
- Windows and Android are both 0.4.2 (APK versionCode 21). Includes the existing 0.4.1 interface and network-adapter fixes.

## 0.4.1 - 2026-10-21

- The PC window header now matches the phone: the view title (all records / month / search) with the connection state below it, and a single menu button. The QR code and month-browsing icons moved into the menu; the title bar shows only "LinkFlow" and, on Windows 11, takes the page colour (kept in sync with light/dark mode).
- Settings (PC and phone): search sits under "Browse by month"; the device name is plain text that is edited in place; the connected computer is one row (tap to reconnect and sync); dark mode is a single tappable row; every row has the same height; the app icon, name and version are centred at the bottom.
- Search is a rounded box with its close button inside. The month bar has a close button on the right (PC and phone) that returns to all records.
- The pairing dialog names the Wi-Fi network to join, the link is plain text and the copy button is an icon. Virtual adapters (VPN, tunnels, virtual machines) are no longer offered as IP addresses.
- Copying text into the PC clipboard is always on; the switch is gone. Thinner line icons on the PC card buttons.
- Esc on the PC and the Android back key share one "close the topmost layer" logic; the menu actions are shared by phone and PC.
- Windows and Android are both 0.4.1 (APK versionCode 20).

## 0.4.0 - 2026-10-20 (not released)

- Phone interface redesigned to review/mobile_design_system.md: the title bar shows the current view name (all records / month / search) with the connection state as small text below it, and a single menu button replaces the scan, month, search and settings buttons.
- Always-visible rounded search field; the title bar and search collapse while scrolling down the list and return on scrolling up.
- The menu is a full-screen "records and settings" page: all records, browse by month, the connected computer with a gear menu (reconnect, scan to change computer), device name, dark mode, clear records (PC only), and the app icon with the version at the bottom. The clipboard switch is no longer shown on phones (it only applies to the PC).
- Photo / image / file sending moved to a floating button; the input bar is a single row. New colors, 24dp panels, 1.8 line icons.
- Android back key closes menus, dialogs, search and the month view before leaving the page.
- The PC window layout is unchanged.

## 0.3.19 - 2026-10-20

- Maintenance release: the connection behavior is unchanged from 0.3.18. Adds the offline regression-check workflow (host probe, transfer, upload and clipboard checks) to the repository.
- Windows and Android are both 0.3.19 (APK versionCode 18).

## 0.3.18 - 2026-10-11

- Android startup immediately shows a local connection screen, with a 4-second host-probe deadline and a 6-second page-readiness deadline. Offline errors stay on the page with retry/change-computer actions and retain the saved pairing.
- Foreground phones automatically reconnect when the paired PC starts: the ready PC emits three finite LAN startup notifications; a fresh HMAC challenge verifies the paired host before invoking the existing connection flow. No periodic phone availability polling, cloud push or background service is added.
- Discovery uses IPv4 UDP (PC 5840, phone 5839), the original paired IP and existing pairing secret. A changed PC address, blocked LAN broadcast or discovery port requires manual retry/re-pairing. Closing or cancelling the phone's waiting screen releases its listener.
- Startup, retry, scan and pasted links share the bounded authenticated probe. New links are saved only after validation; stale/cancelled attempts cannot override a newer connection.
- Windows and Android are both 0.3.18 (APK versionCode 17). Debug verification uses a separate package from the installed release app.

## 0.3.17 - 2026-10-11

- File cards: the file name is regular weight instead of medium, and the size / status lines under it are one step smaller (size 12 → 11 PC, 13 → 12 phone; status 11 → 10 PC, 12 → 11 phone).
- Popups opened from the four header buttons (scan, month, search, settings) are one step smaller: title -2px, body / control / hint -1px; month selectors 14px, record count 13px, search box 15px. The "设置" title is bold.
- The record count "共 N 条" in the month bar is right-aligned.
- Windows app and Android APK both 0.3.17 (APK versionCode 16).

## 0.3.16 - 2026-10-09

- One popup type scale on every client: title 20 / body 16 / control 15 / hint 14 (PC one step smaller: 18 / 15 / 14 / 13). Applies to the settings, scan, connection and clear-all dialogs, the month dropdowns, and the phone's native connection and pairing dialogs (title 24 -> 20, rows 19 -> 16, hints 12 -> 14).
- PC: the "扫码直连" dialog uses the same scan-frame icon as the phone's connection menu instead of the 🔗 emoji, and its close button is a line icon.
- Month bar and search bar: larger text (15px selectors, 16px search box), taller controls, and the search box fills the row with a smaller line-icon clear button.
- Windows app and Android APK both 0.3.16 (APK versionCode 15).

## 0.3.15 - 2026-10-09

- Sender avatars are line icons (phone / desktop / laptop); file cards keep a per-category emoji with many more categories (GIF, APK, PDF, sheets, code, fonts, ...).
- File names are one step smaller on every client (13px on PC/web, 14px on phone) so more of a long name stays visible.
- Phone: text is no longer shrunk to 90% (Android text zoom 100%); meta 13px, message text 16px, file-card buttons 40px.
- Phone: file cards are 256px wide instead of 280px so they no longer stretch across the screen.
- Windows app and Android APK both 0.3.15 (APK versionCode 14).

## 0.3.14 - 2026-10-09

- Files and images a device sent itself no longer show "未接收" or a receive button on that device; only incoming files are tracked.
- Android: the custom device name is stored natively (per app, not per host address), so it survives re-pairing with a new IP. An existing name in the web storage is migrated on first read.
- Settings (PC): the red full-width clear button is now a quiet "清空记录与文件" row with the record count and size. It opens an in-app confirmation that states what will be deleted, and the red button unlocks after 3 s (Esc / outside click cancels).
- All card and menu buttons (copy, locate, download, share, link, delete) use one line-icon set (`static/js/icons.js`) on PC, web and phone instead of emoji; a file this device sent itself gets no download button.
- Windows app and Android APK both 0.3.14 (APK versionCode 13).

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
