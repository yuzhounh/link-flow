/* Keep original files intact. Only name raw clipboard images, never infer a screenshot's origin. */
(function (root) {
  const extensions = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
    'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif',
    'image/tiff': 'tiff', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
    'application/vnd.android.package-archive': 'apk', 'application/pdf': 'pdf',
    'application/zip': 'zip', 'text/plain': 'txt'
  };
  function prepare(files, metadata, now = new Date()) {
    let selected = [...new Set(files)];
    const names = Array.isArray(metadata?.names) ? metadata.names : [];
    // Some sources expose the same copied file as a file and as image pixels.
    // Prefer the entries matching the native file list; never dedupe distinct files by size.
    if (names.length) {
      const originals = selected.filter(file => names.includes(file.name));
      if (originals.length === names.length) selected = originals;
    }
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    return selected.map((file, index) => {
      const type = (file.type || '').toLowerCase().split(';')[0].trim();
      const isImage = type.startsWith('image/');
      const rawImage = isImage && metadata?.hasImage === true && names.length === 0
        && (!file.name || /^(image|blob)(\.[a-z0-9]+)?$/i.test(file.name));
      if (file.name && !rawImage) return file;
      const extension = extensions[type];
      // Unknown encodings stay binary; do not falsely label them PNG.
      const name = `${isImage ? 'Image' : 'File'}_${stamp}_${index + 1}.${extension || 'bin'}`;
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    });
  }
  root.LinkFlowClipboard = { prepare };
  if (typeof module !== 'undefined') module.exports = { prepare };
})(globalThis);
