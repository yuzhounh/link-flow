(() => {
  const states = new Map();
  const acknowledgements = new Map();
  // Shared line icons (icons.js), the same set the rest of the buttons use.
  const receiveIcon = window.LinkFlowIcons.svg('receive', 18);
  const shareIcon = window.LinkFlowIcons.svg('share', 18);
  function key(raw) {
    try { const url = new URL(raw, location.href); url.search = ''; url.hash = ''; return url.href; }
    catch (_) { return ''; }
  }
  // Seen markers live in one map capped at SEEN_LIMIT entries (oldest dropped), instead of one key per
  // received file forever; per-file keys from earlier versions are moved in once.
  const SEEN_KEY = 'linkflow-received-seen', SEEN_LIMIT = 1000;
  const seen = (() => {
    let map = {};
    try {
      map = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
      const legacy = Object.keys(localStorage).filter(name => name.startsWith(SEEN_KEY + ':'));
      for (const name of legacy) map[name.slice(SEEN_KEY.length + 1)] ??= localStorage.getItem(name);
      if (legacy.length) {
        map = Object.fromEntries(Object.entries(map).slice(-SEEN_LIMIT));
        localStorage.setItem(SEEN_KEY, JSON.stringify(map)); // Saved before the old keys go.
        for (const name of legacy) localStorage.removeItem(name);
      }
    } catch (_) { }
    return new Map(Object.entries(map).slice(-SEEN_LIMIT));
  })();
  function saveSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seen))); } catch (_) { }
  }
  function acknowledged(url, state) {
    const id = acknowledgements.get(url) || seen.get(url);
    return id === String(state.downloadId || 'host');
  }
  function stateFor(card, url) {
    return card.dataset.hostReceived === 'true' ? {status: 'complete', percent: 100, downloadId: 'host'} : states.get(url) || {status: 'idle', percent: 0};
  }
  function action(mode, raw) {
    const url = new URL(raw, location.href);
    if (window.LinkFlowAndroid) {
      location.href = 'linkflow://file-action?mode=' + encodeURIComponent(mode) + '&url=' + encodeURIComponent(url.href);
    } else {
      const link = document.createElement('a'); link.href = url.href; link.download = '';
      document.body.appendChild(link); link.click(); link.remove();
    }
  }
  function apply(root = document) {
    const cards = root.matches?.('.file-card') ? [root] : root.querySelectorAll('.file-card');
    for (const card of cards) {
      if (card.dataset.receiving === 'true' || card.dataset.own === 'true') continue;
      const link = card.querySelector('.file-name[href]');
      const url = key(card.dataset.fileUrl || link?.href);
      if (!url || !link) continue;
      const state = stateFor(card, url);
      let label = card.querySelector('.download-status');
      if (!label) {
        label = document.createElement('div');
        label.className = 'download-status';
        card.querySelector('.file-info').appendChild(label);
      }
      const percent = Number.isFinite(state.percent) ? Math.max(0, Math.min(100, state.percent)) : 0;
      card.style.setProperty('--download-progress', `${percent}%`);
      card.classList.toggle('download-active', state.status === 'running' || state.status === 'paused');
      card.classList.toggle('download-complete', state.status === 'complete');
      card.classList.toggle('download-acknowledged', state.status === 'complete' && acknowledged(url, state));
      card.classList.toggle('download-failed', state.status === 'failed');
      label.setAttribute('role', 'progressbar');
      label.setAttribute('aria-label', '文件接收');
      label.setAttribute('aria-valuemin', '0'); label.setAttribute('aria-valuemax', '100');
      if (state.percent >= 0) label.setAttribute('aria-valuenow', String(percent));
      else label.removeAttribute('aria-valuenow');
      // A received card is already shown by its background and share button, so it needs no status row.
      label.hidden = state.status === 'complete';
      const isEn = window.LinkFlowI18N && window.LinkFlowI18N.isEn();
      if (state.status === 'complete') label.textContent = isEn ? 'Received' : '已接收';
      else if (state.status === 'failed') label.textContent = (isEn ? 'Failed · ' : '接收失败 · ') + (state.detail || (isEn ? 'Retry' : '点击重试'));
      else if (state.status === 'missing') label.textContent = isEn ? 'Deleted · Re-download' : '本地文件已删除 · 可重新接收';
      else if (state.status === 'idle') label.textContent = window.LinkFlowServerOnline === false ? (isEn ? 'Not received · Waiting for PC' : '未接收 · 等待电脑上线') : (isEn ? 'Not received' : '未接收');
      else if (state.status === 'paused') label.textContent = (isEn ? 'Paused' : '接收暂停') + (state.percent >= 0 ? ' ' + percent + '%' : '') + (isEn ? ' · Waiting for network' : ' · 等待网络');
      else label.textContent = state.percent >= 0 ? (isEn ? `Receiving ${percent}%` : `接收中 ${percent}%`) : (isEn ? 'Receiving…' : '正在接收 · 获取文件大小');
      label.setAttribute('aria-valuetext', label.textContent);
      if (card.dataset.hostReceived !== 'true' && window.LinkFlowAndroid) {
        let button = card.querySelector('.receive-action');
        if (!button) {
          button = document.createElement('button'); button.type = 'button'; button.className = 'file-op-btn receive-action';
          card.querySelector('.file-ops').replaceChildren(button);
        }
        const busy = state.status === 'running' || state.status === 'paused';
        const done = state.status === 'complete';
        const title = done ? '分享' : busy ? (state.percent >= 0 ? percent + '%' : '接收中') : state.status === 'failed' ? '重试' : state.status === 'missing' ? '重新接收' : '接收';
        button.title = title; button.setAttribute('aria-label', title);
        button.disabled = busy || (!done && window.LinkFlowServerOnline === false);
        button.innerHTML = done ? shareIcon : busy ? (state.percent >= 0 ? percent + '%' : '…') : receiveIcon;
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); action(done ? 'share' : 'receive', link.href); };
      }
      // A compressed copy has its own status and must never mark the original received.
      for (const variant of card.querySelectorAll('.file-thumb-link')) {
        if (key(variant.href) === url) continue;
        if (!variant.dataset.baseText) variant.dataset.baseText = variant.textContent;
        const thumb = states.get(key(variant.href));
        variant.textContent = variant.dataset.baseText + (thumb?.status === 'complete' ? ' · 已接收' : thumb?.status === 'running' ? ` · 接收中 ${Math.max(0, thumb.percent)}%` : '');
      }
    }
  }
  window.LinkFlowDownloadProgress = state => {
    if (!state || !['running', 'paused', 'complete', 'failed', 'missing'].includes(state.status)) return;
    const url = key(state.url);
    if (!url) return;
    states.set(url, state);
    apply();
  };
  document.addEventListener('click', event => {
    const card = event.target.closest?.('.file-card');
    if (!card || card.dataset.receiving === 'true' || card.dataset.own === 'true') return;
    const url = key(card.dataset.fileUrl || card.querySelector('.file-name')?.href);
    const state = stateFor(card, url);
    if (state.status !== 'complete') return;
    const id = String(state.downloadId || 'host');
    acknowledgements.set(url, id);
    seen.delete(url);
    seen.set(url, id);
    while (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value);
    saveSeen();
    card.classList.add('download-acknowledged');
  }, true);
  window.LinkFlowDownloads = { apply, action, isReceived: raw => states.get(key(raw))?.status === 'complete' };
})();
