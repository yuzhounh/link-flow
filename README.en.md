<p align="center">
  <img src="static/icon-192.png" width="96" alt="LinkFlow logo">
</p>

<h1 align="center">LinkFlow</h1>

<p align="center"><a href="README.md">简体中文</a> · English</p>

<p align="center"><strong>Zero-configuration LAN file transfer and clipboard sync assistant between PC and mobile devices.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=flat" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Web-0078d4?style=flat" alt="Platform: Windows | Web">
  <img src="https://img.shields.io/badge/C%23-.NET%2010-512bd4?style=flat&amp;logo=dotnet&amp;logoColor=white" alt="C#: .NET 10">
</p>

## Highlights

- **Instant Local Sync**: Share text, links, photos, videos, and arbitrary files across PC and smartphones over local Wi-Fi without cloud reliance.
- **QR Code Pairing**: Instant connection via phone camera QR code scan or pairing link.
- **Timeline Organization**: Browse past transfers by month, search file contents and names, drag-and-drop send.
- **1-Click Bilingual Interface**: Instant language toggle in header actions and settings modal (`[L]` keyboard shortcut).
- **Responsive & Dark Mode**: Mobile PWA interface with full dark mode support.

## Build

```powershell
dotnet publish LinkFlow.csproj -c Release -o dist
```

## License

[MIT](LICENSE)
