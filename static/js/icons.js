// Shared line icons for devices/actions, with emoji for file categories.
(() => {
  const PATHS = {
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    receive: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 4H5.5A1.5 1.5 0 0 0 4 5.5v10"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    // Device avatars.
    mobile: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    computer: '<rect x="4" y="4" width="16" height="11.5" rx="1.5"/><path d="M4 15.5 2.5 19a.7.7 0 0 0 .7 1h17.6a.7.7 0 0 0 .7-1L20 15.5M9.5 17.5h5"/>'
  };
  const FILE_TYPES = [
    { kind: 'gif', emoji: '🎞️', extensions: ['GIF'] },
    { kind: 'image', emoji: '🖼️', extensions: ['JPG', 'JPEG', 'PNG', 'WEBP', 'BMP', 'SVG', 'HEIC', 'HEIF', 'ICO', 'AVIF', 'TIF', 'TIFF'] },
    { kind: 'video', emoji: '🎬', extensions: ['MP4', 'MKV', 'MOV', 'AVI', 'WEBM', 'FLV', 'M4V', 'MPEG', 'MPG', '3GP'] },
    { kind: 'audio', emoji: '🎵', extensions: ['MP3', 'WAV', 'FLAC', 'AAC', 'OGG', 'M4A', 'OPUS', 'WMA', 'MID', 'MIDI', 'AIFF'] },
    { kind: 'archive', emoji: '🗂️', extensions: ['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'BZ2', 'XZ', 'TGZ', 'ZST'] },
    { kind: 'apk', emoji: '📲', extensions: ['APK', 'AAB', 'APKS', 'XAPK'] },
    { kind: 'installer', emoji: '📦', extensions: ['EXE', 'MSI', 'MSIX', 'APPX', 'DMG', 'PKG', 'DEB', 'RPM', 'APPIMAGE'] },
    { kind: 'pdf', emoji: '📃', extensions: ['PDF'] },
    { kind: 'doc', emoji: '📝', extensions: ['DOC', 'DOCX', 'ODT', 'RTF', 'PAGES'] },
    { kind: 'sheet', emoji: '📊', extensions: ['XLS', 'XLSX', 'XLSM', 'ODS', 'CSV', 'TSV', 'NUMBERS'] },
    { kind: 'slides', emoji: '📽️', extensions: ['PPT', 'PPTX', 'PPS', 'PPSX', 'ODP', 'KEY'] },
    { kind: 'text', emoji: '📄', extensions: ['TXT', 'TEXT'] },
    { kind: 'markdown', emoji: '📑', extensions: ['MD', 'MDX', 'MARKDOWN', 'RST', 'TEX'] },
    { kind: 'ebook', emoji: '📚', extensions: ['EPUB', 'MOBI', 'AZW', 'AZW3', 'FB2', 'CBZ', 'CBR'] },
    { kind: 'web', emoji: '🌐', extensions: ['HTML', 'HTM', 'XHTML', 'URL', 'WEBSITE'] },
    { kind: 'code', emoji: '📜', extensions: ['JS', 'MJS', 'CJS', 'TS', 'JSX', 'TSX', 'PY', 'CS', 'JAVA', 'C', 'H', 'CPP', 'HPP', 'GO', 'RS', 'PHP', 'RB', 'SWIFT', 'KT', 'KTS', 'CSS', 'SCSS', 'LESS', 'SH', 'PS1', 'BAT', 'CMD', 'SQL', 'VUE', 'SVELTE'] },
    { kind: 'config', emoji: '⚙️', extensions: ['JSON', 'JSONC', 'YAML', 'YML', 'TOML', 'INI', 'CFG', 'CONF', 'XML', 'ENV'] },
    { kind: 'database', emoji: '🗃️', extensions: ['DB', 'SQLITE', 'SQLITE3', 'MDB', 'ACCDB', 'PARQUET', 'ARROW'] },
    { kind: 'font', emoji: '🔤', extensions: ['TTF', 'OTF', 'WOFF', 'WOFF2', 'TTC'] },
    { kind: 'design', emoji: '🎨', extensions: ['PSD', 'PSB', 'AI', 'EPS', 'SKETCH', 'FIG', 'XD', 'AFDESIGN', 'AFPHOTO'] },
    { kind: 'disk', emoji: '💿', extensions: ['ISO', 'IMG', 'VHD', 'VHDX', 'VMDK', 'QCOW2'] }
  ];
  // Menu labels start with an emoji; this maps it to the icon that replaces it.
  const BY_EMOJI = { '🔗': 'link', '⬇️': 'receive', '🗑️': 'trash', '📋': 'copy', '✂️': 'text', '📁': 'folder' };
  window.LinkFlowIcons = {
    BY_EMOJI,
    // Categories affect presentation only, not file handling or transfer behaviour.
    fileType(ext) {
      const extension = String(ext || '').trim().replace(/^\./, '').toUpperCase();
      return FILE_TYPES.find(type => type.extensions.includes(extension))?.kind || 'other';
    },
    fileEmoji(kind) {
      return FILE_TYPES.find(type => type.kind === kind)?.emoji || '📎';
    },
    svg(name, size = 18, stroke = 2) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
    }
  };
})();
