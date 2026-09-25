# Changelog

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
