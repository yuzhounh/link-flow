// LinkFlow Client Application
(function() {
  // 1. Device detection
  // iPadOS 13+ reports a Macintosh UA; tell it apart from a real Mac by touch support
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // Which side of the timeline this browser is on: the PC running LinkFlow is 'pc', every other
  // device (phone, tablet, another computer) is 'phone' - the same rule the server applies.
  const currentDevice = () => (isHost ? 'pc' : 'phone');

  if (isMobile) {
    document.documentElement.classList.add('is-mobile');
    document.body.classList.add('is-mobile');
  } else {
    document.documentElement.classList.add('is-desktop');
    document.body.classList.add('is-desktop');
  }

  // 2. State variables
  const queryToken = new URLSearchParams(window.location.search).get('token') || '';
  let authToken = queryToken || localStorage.getItem('linkflow_pairing_token') || '';
  let pairingToken = authToken;
  if (queryToken) {
    localStorage.setItem('linkflow_pairing_token', queryToken);
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set('X-LinkFlow-Token', authToken);
    return fetch(url, { ...options, headers });
  }

  // Device name shown next to this device's messages. Editable in settings, kept in this browser.
  let hostName = '';
  let hostKind = '';

  // 'mobile' (phone/tablet), 'desktop' or 'computer' (laptop / other computers).
  // Only the PC running LinkFlow can tell a desktop from a laptop.
  function deviceKind() {
    if (isMobile) return 'mobile';
    return isHost && hostKind === 'desktop' ? 'desktop' : 'computer';
  }

  function guessDeviceName() {
    const ua = navigator.userAgent || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    const android = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
    const model = android && android[1] && android[1] !== 'K' ? android[1].trim() : '';
    if (/Android/.test(ua)) return model || (/Mobile/.test(ua) ? '安卓手机' : '安卓平板');
    if (/Windows/.test(ua)) return 'Windows 电脑';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Linux|X11/.test(ua)) return 'Linux 电脑';
    return isMobile ? '手机' : '电脑';
  }

  function getDeviceName() {
    let saved = '';
    try { saved = localStorage.getItem('linkflow_device_name') || ''; } catch (e) { /* storage unavailable */ }
    return saved || (isHost && hostName ? hostName : guessDeviceName());
  }

  function deviceIcon(msg) {
    const kind = msg.device_kind || (msg.sender === 'phone' ? 'mobile' : 'computer');
    return kind === 'mobile' ? '📱' : kind === 'desktop' ? '🖥️' : '💻';
  }

  function senderLabel(msg) {
    return msg.device_name || (msg.sender === 'phone' ? '手机' : '电脑');
  }

  function protectedThumbUrl(thumbPath, absolute = false) {
    const base = absolute ? window.location.origin : '';
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    return `${base}/thumbs/${encodeURI(thumbPath || '')}${tokenQuery}`;
  }

  function protectedFileUrl(filePath, absolute = false) {
    const base = absolute ? window.location.origin : '';
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    return `${base}/files/${encodeURI(filePath || '')}${tokenQuery}`;
  }

  let ws = null;
  let lanIp = location.hostname;
  let allIps = [];
  let port = location.port || (location.protocol === 'https:' ? '443' : '80');
  let autoClipboard = true;
  let maxUploadBytes = 256 * 1024 * 1024;
  let isHost = !isMobile && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  let qrcodeObj = null;
  let allMessages = [];
  let currentViewMonth = null;

  // Live view loads the newest PAGE_SIZE messages; older ones are pulled in when scrolling up.
  const PAGE_SIZE = 30;
  const SEARCH_LIMIT = 200;
  let hasMoreOlder = false;
  let loadingOlder = false;
  let searchSeq = 0;
  let searchTimer = null;

  // DOM elements
  const chatHistory = document.getElementById('chat-history');
  const chatInputBox = document.getElementById('chat-input-box');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const dropZone = document.getElementById('drop-zone');
  const toast = document.getElementById('toast');

  // Month & History Banner DOM
  const openCalendarBtn = document.getElementById('open-calendar-btn');
  const historyBanner = document.getElementById('history-banner');
  const monthYearDd = document.getElementById('month-year-dd');
  const monthYearBtn = document.getElementById('month-year-btn');
  const monthYearList = document.getElementById('month-year-list');
  const monthMonthDd = document.getElementById('month-month-dd');
  const monthMonthBtn = document.getElementById('month-month-btn');
  const monthMonthList = document.getElementById('month-month-list');
  const monthPrevBtn = document.getElementById('month-prev-btn');
  const monthNextBtn = document.getElementById('month-next-btn');
  const monthCurrentBtn = document.getElementById('month-current-btn');
  const historyBannerCount = document.getElementById('history-banner-count');
  const exitHistoryBtn = document.getElementById('exit-history-btn');

  // Modals
  const qrModal = document.getElementById('qr-modal');
  const openQrBtn = document.getElementById('open-qr-btn');
  const closeQrModal = document.getElementById('close-qr-modal');
  const doneQrBtn = document.getElementById('done-qr-btn');
  const qrUrlText = document.getElementById('qr-url-text');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const ipSelect = document.getElementById('ip-select');
  const ipSwitchBox = document.getElementById('ip-switch-box');

  const settingsModal = document.getElementById('settings-modal');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const closeSettingsModal = document.getElementById('close-settings-modal');
  const settingAutoClipboard = document.getElementById('setting-auto-clipboard');
  const settingDarkTheme = document.getElementById('setting-dark-theme');
  const settingDeviceName = document.getElementById('setting-device-name');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const storageStatsText = document.getElementById('storage-stats-text');
  const appVersionText = document.getElementById('app-version-text');

  const lightboxMask = document.getElementById('lightbox-mask');
  const lightboxImg = document.getElementById('lightbox-img');

  const toggleSearchBtn = document.getElementById('toggle-search-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const closeSearchBtn = document.getElementById('close-search-btn');

  const fileInput = document.getElementById('file-input');
  const mediaInput = document.getElementById('media-input');
  const cameraInput = document.getElementById('camera-input');

  function applyHostCapabilities() {
    if (settingAutoClipboard) settingAutoClipboard.disabled = !isHost;
    if (clearAllBtn) clearAllBtn.hidden = !isHost;
    if (openQrBtn) openQrBtn.hidden = !isHost;
  }

  applyHostCapabilities();

  // Theme initialization
  const themeColorMeta = document.getElementById('theme-color-meta');
  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (themeColorMeta) themeColorMeta.content = '#1f1f1f';
      if (settingDarkTheme) settingDarkTheme.checked = true;
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeColorMeta) themeColorMeta.content = '#f7f7f7';
      if (settingDarkTheme) settingDarkTheme.checked = false;
    }
  }

  const savedTheme = localStorage.getItem('linkflow_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme === 'dark' || (!savedTheme && prefersDark));

  settingDarkTheme.addEventListener('change', (e) => {
    applyTheme(e.target.checked);
    localStorage.setItem('linkflow_theme', e.target.checked ? 'dark' : 'light');
  });

  if (settingDeviceName) {
    settingDeviceName.addEventListener('change', () => {
      const name = settingDeviceName.value.trim();
      try {
        if (name) localStorage.setItem('linkflow_device_name', name);
        else localStorage.removeItem('linkflow_device_name');
      } catch (e) { /* storage unavailable */ }
      settingDeviceName.value = getDeviceName();
      showToast('设备名称已更新');
    });
  }

  // 3. WebSocket Connection
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    const wsUrl = `${protocol}//${location.host}/ws${tokenQuery}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      statusDot.classList.add('online');
      statusText.textContent = '实时同步中';
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleIncomingWS(data);
      } catch (err) {
        console.error('Error parsing WS message', err);
      }
    };

    ws.onclose = () => {
      statusDot.classList.remove('online');
      statusText.textContent = authToken || isHost ? '连接断开，重试中...' : '需要重新扫码配对';
      setTimeout(connectWebSocket, 2500);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error', err);
    };
  }

  function handleIncomingWS(data) {
    if (data.type === 'connected') {
      lanIp = data.lan_ip || location.hostname;
      port = data.port || location.port;
      autoClipboard = data.auto_clipboard;
      settingAutoClipboard.checked = autoClipboard;
      if (typeof data.is_host === 'boolean') {
        const oldIsHost = isHost;
        isHost = data.is_host;
        if (oldIsHost !== isHost && allMessages.length > 0) {
          renderMessages(allMessages);
        }
        applyHostCapabilities();
      }
    } else if (data.type === 'new_message') {
      const msg = data.message;
      if (currentViewMonth) {
        const msgMonth = getLocalMonthString(msg.timestamp);
        if (msgMonth === currentViewMonth) {
          appendLiveMessage(msg);
          updateHistoryBannerCount();
        } else {
          showToast(`收到来自${deviceIcon(msg)} ${senderLabel(msg)}的新消息，点击「返回实时」查看`);
        }
      } else {
        appendLiveMessage(msg);
      }
    } else if (data.type === 'message_deleted') {
      const row = document.getElementById(`msg-${data.id}`);
      if (row) row.remove();
      allMessages = allMessages.filter(m => m.id !== data.id);
      if (currentViewMonth) updateHistoryBannerCount();
    } else if (data.type === 'messages_cleared') {
      chatHistory.innerHTML = '';
      allMessages = [];
      hasMoreOlder = false;
      if (currentViewMonth) exitHistoryMode();
      showToast('聊天记录已清空');
    } else if (data.type === 'wake_tab') {
      triggerTabWakeNotice();
    } else if (data.type === 'error') {
      showToast(data.error || '操作未完成');
    }
  }

  // 4. REST API & Initial Load
  async function loadInitialData() {
    try {
      const [msgRes, infoRes] = await Promise.all([
        apiFetch(`/api/messages?limit=${PAGE_SIZE}`),
        apiFetch('/api/system/info')
      ]);

      if (msgRes.status === 401 || infoRes.status === 401) {
        statusText.textContent = '配对已失效，请在电脑端重新扫码';
        return;
      }

      const msgData = await msgRes.json();
      if (msgData.status === 'ok') {
        applyLiveMessages(msgData.messages);
      }

      const infoData = await infoRes.json();
      if (infoData.status === 'ok') {
        lanIp = infoData.lan_ip;
        allIps = infoData.all_ips || [lanIp];
        port = infoData.port;
        autoClipboard = infoData.auto_clipboard;
        maxUploadBytes = infoData.max_upload_bytes || maxUploadBytes;
        hostName = infoData.host_name || '';
        hostKind = infoData.host_kind || '';
        if (infoData.pairing_token) pairingToken = infoData.pairing_token;
        if (appVersionText && infoData.version) appVersionText.textContent = `LinkFlow v${infoData.version}`;
        if (typeof infoData.is_host === 'boolean') {
          const oldIsHost = isHost;
          isHost = infoData.is_host;
          if (oldIsHost !== isHost && allMessages.length > 0) {
            renderMessages(allMessages);
          }
          applyHostCapabilities();
        }
        if (settingDeviceName) {
          settingDeviceName.value = getDeviceName();
          settingDeviceName.placeholder = isHost && hostName ? hostName : guessDeviceName();
        }
        settingAutoClipboard.checked = autoClipboard;
        updateStorageStats(infoData.stats);
        setupIpSelector();
      }
      fillIfShort();
    } catch (e) {
      console.error('Failed to load initial data', e);
    }
  }

  function applyLiveMessages(messages) {
    allMessages = messages || [];
    hasMoreOlder = allMessages.length >= PAGE_SIZE;
    renderMessages(allMessages);
  }

  // Prepends the next older page, keeping the viewport where it was.
  async function loadOlderMessages() {
    if (loadingOlder || currentViewMonth || !hasMoreOlder || allMessages.length === 0) return false;
    loadingOlder = true;
    try {
      const beforeTs = allMessages[0].timestamp;
      const res = await apiFetch(`/api/messages?limit=${PAGE_SIZE}&before_ts=${encodeURIComponent(beforeTs)}`);
      const data = await res.json();
      if (data.status !== 'ok' || currentViewMonth) return false;
      const older = data.messages || [];
      hasMoreOlder = older.length >= PAGE_SIZE;
      allMessages = older.concat(allMessages);
      renderMessages(allMessages, true);
      return older.length > 0;
    } catch (e) {
      console.error('Failed to load older messages', e);
      return false;
    } finally {
      loadingOlder = false;
    }
  }

  // A short page may not fill the screen, so there would be nothing to scroll up from.
  async function fillIfShort() {
    while (!currentViewMonth && hasMoreOlder && chatHistory.scrollHeight <= chatHistory.clientHeight + 40) {
      if (!(await loadOlderMessages())) break;
    }
  }

  chatHistory.addEventListener('scroll', () => {
    if (chatHistory.scrollTop < 80 && !searchInput.value.trim()) loadOlderMessages();
  }, { passive: true });

  function updateStorageStats(stats) {
    if (!stats || !storageStatsText) return;
    const mb = (stats.total_file_size / (1024 * 1024)).toFixed(1);
    storageStatsText.textContent = `共保存 ${stats.total_messages} 条记录，文件累计占用 ${mb} MB`;
  }

  // 5. Message Timeline Rendering
  function formatTime(timestamp) {
    const d = new Date(timestamp);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function formatDateHeader(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const month = d.getMonth() + 1;
    const date = d.getDate();
    return isToday ? '今天' : `${month}月${date}日`;
  }

  // Live-appended messages need a date divider too when the day changes
  function appendLiveMessage(msg) {
    const prev = allMessages[allMessages.length - 1];
    allMessages.push(msg);
    if (!prev || new Date(prev.timestamp).toDateString() !== new Date(msg.timestamp).toDateString()) {
      const divider = document.createElement('div');
      divider.className = 'timeline-date-divider';
      divider.textContent = formatDateHeader(msg.timestamp);
      chatHistory.appendChild(divider);
    }
    appendMessageToUI(msg, true);
  }

  function renderMessages(messages, keepScroll = false) {
    const prevHeight = chatHistory.scrollHeight;
    const prevTop = chatHistory.scrollTop;
    chatHistory.innerHTML = '';
    let lastDate = '';

    // Live view with everything loaded (not a search result or a single month)
    if (messages === allMessages && !currentViewMonth && !hasMoreOlder && messages.length > 0) {
      const hint = document.createElement('div');
      hint.className = 'timeline-date-divider timeline-top-hint';
      hint.textContent = '没有更早的记录了';
      chatHistory.appendChild(hint);
    }

    messages.forEach(msg => {
      const dateStr = formatDateHeader(msg.timestamp);
      if (dateStr !== lastDate) {
        const divider = document.createElement('div');
        divider.className = 'timeline-date-divider';
        divider.textContent = dateStr;
        chatHistory.appendChild(divider);
        lastDate = dateStr;
      }
      appendMessageToUI(msg, false);
    });

    if (keepScroll) {
      // #chat-history has scroll-behavior: smooth; restoring the position must not animate
      chatHistory.scrollTo({ top: prevTop + chatHistory.scrollHeight - prevHeight, behavior: 'instant' });
    } else {
      // Jump, don't animate: a smooth scroll starting at the top would trip the
      // "load older messages" handler and get cancelled halfway.
      chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'instant' });
    }
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function splitFileName(filename) {
    if (!filename) return { baseName: '', ext: '' };
    const name = String(filename);
    const lower = name.toLowerCase();
    if (lower.endsWith('.tar.gz')) {
      return {
        baseName: name.slice(0, -7),
        ext: name.slice(-7)
      };
    }
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      return {
        baseName: name.slice(0, lastDot),
        ext: name.slice(lastDot)
      };
    }
    return {
      baseName: name,
      ext: ''
    };
  }

  function appendMessageToUI(msg, autoScroll = true) {
    const isSelf = (msg.sender === currentDevice());
    const row = document.createElement('div');
    row.id = `msg-${msg.id}`;
    row.className = `message-row sender-${msg.sender} ${isSelf ? 'is-current-device' : 'is-peer-device'}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'sender-avatar';
    // Phone icon for phones and tablets, desktop or laptop icon for computers.
    avatar.textContent = deviceIcon(msg);

    // Body container
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'message-body-wrap';

    // Meta header (sender & time)
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${senderLabel(msg)} · ${formatTime(msg.timestamp)}`;
    bodyWrap.appendChild(meta);

    // Message Bubble Wrapper (contains bubble/card + unified action bar)
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'bubble-wrapper';

    // Actions mini menu (unified for text and all file types)
    const actions = document.createElement('div');
    actions.className = 'bubble-actions';

    // Photos keep a small compressed copy. On the PC the card's round button copies it, and the
    // side menu offers original / locate / delete; elsewhere the menu offers both copies.
    const hasThumb = msg.msg_type !== 'text' && !!msg.thumb_path;
    const hostThumb = hasThumb && isHost;
    const addAction = (label, handler) => {
      const btn = document.createElement('button');
      btn.className = 'action-btn-mini';
      btn.innerHTML = label;
      btn.onclick = (e) => {
        e.stopPropagation();
        handler();
      };
      actions.appendChild(btn);
    };

    if (hostThumb) {
      addAction('📋 复制原图', () => copyMessage(msg, false));
      addAction('📁 定位', () => revealInFolder(msg.id));
    } else {
      addAction(hasThumb ? '📋 复制压缩图' : '📋 复制', () => copyMessage(msg, hasThumb));
      if (hasThumb) addAction('📋 复制原图', () => copyMessage(msg, false));
    }

    const isFileMsg = (msg.msg_type !== 'text');
    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn-mini';
    delBtn.innerHTML = '🗑️ 删除';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMessage(msg.id, isFileMsg);
    };
    actions.appendChild(delBtn);

    // Content Bubble based on msg_type
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.msg_type === 'text') {
      const textSpan = document.createElement('span');
      textSpan.innerHTML = escapeAndLinkText(msg.content);
      bubble.appendChild(textSpan);
    } else {
      // Unified file card for all files (PDF, images, videos, audios, archives, docs, etc.)
      bubble.className = 'file-card';
      const ext = (msg.file_name ? msg.file_name.split('.').pop() : 'FILE').toUpperCase();
      let icon = '📦';
      if (['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'BMP', 'SVG', 'HEIC', 'ICO', 'AVIF'].includes(ext)) {
        icon = '🖼️';
      } else if (ext === 'PDF' || ['DOC', 'DOCX', 'TXT', 'MD', 'XLS', 'XLSX', 'PPT', 'PPTX', 'CSV'].includes(ext)) {
        icon = '📄';
      } else if (['MP4', 'MKV', 'MOV', 'AVI', 'WEBM', 'FLV'].includes(ext)) {
        icon = '🎬';
      } else if (['MP3', 'WAV', 'FLAC', 'AAC', 'OGG', 'M4A'].includes(ext)) {
        icon = '🎵';
      } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'BZ2'].includes(ext)) {
        icon = '📦';
      }

      const { baseName, ext: fileExtWithDot } = splitFileName(msg.file_name || 'file');

      bubble.innerHTML = `
        <div class="file-icon-box"><span class="file-icon">${icon}</span><span class="file-ext-label">${escapeHtml(ext)}</span></div>
        <div class="file-info">
          <a class="file-name" href="${protectedFileUrl(msg.file_path)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(msg.file_name || '')}"><span class="file-name-base">${escapeHtml(baseName)}</span><span class="file-name-ext">${escapeHtml(fileExtWithDot)}</span></a>
          ${msg.thumb_path
            ? `<a class="file-meta file-thumb-link" href="${protectedFileUrl(msg.file_path)}" target="_blank" rel="noopener noreferrer" title="查看原图">原图 · ${formatFileSize(msg.file_size)}</a>`
            : `<div class="file-meta">${formatFileSize(msg.file_size)}</div>`}
          ${msg.thumb_path ? `<a class="file-meta file-thumb-link" href="${protectedThumbUrl(msg.thumb_path)}" target="_blank" rel="noopener noreferrer" title="查看压缩图">压缩图 · ${formatFileSize(msg.thumb_size)}</a>` : ''}
        </div>
        <div class="file-ops">
          ${hostThumb ? `<button class="file-op-btn copy-thumb-btn" title="复制压缩图">📋</button>` : isHost ? `<button class="file-op-btn open-folder-btn" title="在文件夹中定位">📁</button>` : `<a class="file-op-btn" href="${protectedFileUrl(msg.file_path)}" download="${escapeHtml(msg.file_name || '')}" title="下载保存">⬇️</a>`}
        </div>
      `;
      if (isHost) {
        const btn = bubble.querySelector('.open-folder-btn');
        if (btn) btn.onclick = () => revealInFolder(msg.id);
        const copyThumb = bubble.querySelector('.copy-thumb-btn');
        if (copyThumb) copyThumb.onclick = () => copyMessage(msg, true);
        // Non-previewable files: let the PC open them (or locate them), not the browser.
        if (!isBrowserPreviewable(fileExtWithDot)) {
          bubble.querySelector('a.file-name').addEventListener('click', (e) => {
            e.preventDefault();
            openOnHost(msg.id);
          });
        }
      }
    }

    bubbleWrapper.appendChild(bubble);
    bubbleWrapper.appendChild(actions);

    if (isMobile) {
      bubbleWrapper.addEventListener('click', (e) => {
        if (e.target.closest('a, button, video, audio')) return;
        document.querySelectorAll('.bubble-actions.show').forEach(el => {
          if (el !== actions) el.classList.remove('show');
        });
        actions.classList.toggle('show');
      });
    }

    bodyWrap.appendChild(bubbleWrapper);

    row.appendChild(avatar);
    row.appendChild(bodyWrap);
    chatHistory.appendChild(row);

    if (autoScroll) {
      scrollToBottom();
    }
  }

  function escapeAndLinkText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    let safe = div.innerHTML;
    // Replace URL links
    const urlPattern = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    safe = safe.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline;">$1</a>');
    // Convert newlines to <br>
    return safe.replace(/\n/g, '<br>');
  }

  function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // Set responsive placeholder
  if (messageInput) {
    messageInput.placeholder = isMobile ? '输入消息...' : '输入文字，或直接拖入 / 粘贴文件...';
  }

  // 6. Sending Messages & Uploads
  function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'text',
        sender: currentDevice(),
        device: getDeviceName(),
        kind: deviceKind(),
        content: text,
        timestamp: Date.now()
      }));
      messageInput.value = '';
      messageInput.style.height = '56px';
      messageInput.style.overflowY = 'hidden';
    } else {
      showToast('连接未就绪，正在重连...');
    }
  }

  sendBtn.addEventListener('click', sendTextMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  if (chatInputBox) {
    chatInputBox.addEventListener('click', (e) => {
      if (!e.target.closest('button, label, input')) {
        messageInput.focus();
      }
    });
  }

  // Auto-grow textarea smoothly
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    const baseH = 56;
    const maxH = 160;
    const scrollH = messageInput.scrollHeight;
    const targetH = Math.min(Math.max(scrollH, baseH), maxH);
    messageInput.style.height = targetH + 'px';
    messageInput.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  });

  async function uploadFiles(files) {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    const total = fileList.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const file = fileList[i];
      if (file.size > maxUploadBytes) {
        showToast(`${file.name} 超过 ${formatFileSize(maxUploadBytes)} 上传上限`);
        continue;
      }
      if (total > 1) {
        showToast(`正在传输 (${i + 1}/${total}): ${file.name}...`);
      } else {
        showToast(`正在传输: ${file.name}...`);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('sender', currentDevice());
      formData.append('device', getDeviceName());
      formData.append('kind', deviceKind());

      try {
        const res = await apiFetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
        if (result.status === 'ok') {
          successCount++;
          if (total === 1) {
            showToast('传输成功');
          }
        } else {
          showToast(`上传失败 (${file.name}): ${result.error || '未知错误'}`);
        }
      } catch (err) {
        console.error('Upload error', err);
        showToast(`传输失败 (${file.name})，请检查网络`);
      }
    }

    if (total > 1) {
      if (successCount === total) {
        showToast(`全部传输成功 (共 ${total} 个文件)`);
      } else {
        showToast(`传输完成: 成功 ${successCount}/${total} 个文件`);
      }
    }
  }

  // File pickers
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    fileInput.value = '';
    uploadFiles(files);
  });

  mediaInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    mediaInput.value = '';
    uploadFiles(files);
  });

  cameraInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    cameraInput.value = '';
    uploadFiles(files);
  });

  // 7. Clipboard & Drag and Drop
  // Ctrl+V paste screenshots
  window.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.items) {
      const items = e.clipboardData.items;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const blob = items[i].getAsFile();
          if (blob) {
            // Give pasted screenshot a meaningful timestamped name
            const ext = blob.type.split('/')[1] || 'png';
            const screenshotFile = new File([blob], `Screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: blob.type });
            files.push(screenshotFile);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        uploadFiles(files);
      }
    }
  });

  // Drag and drop
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('active');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dropZone.classList.remove('active');
      dragCounter = 0;
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // 8. Clipboard Copy & Local Operations
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('已复制到剪贴板');
    } catch (e) {
      showToast('复制失败');
    }
    document.body.removeChild(ta);
  }

  async function copyMessage(msg, compressed = false) {
    if (msg.msg_type === 'text') {
      copyToClipboard(msg.content);
      return;
    }

    if (isHost) {
      try {
        const res = await apiFetch('/api/system/copy-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: msg.id, variant: compressed ? 'compressed' : 'original' })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.status === 'ok') {
          showToast('已复制文件');
        } else {
          const errMsg = (data && data.error) ? data.error : '文件复制失败，请检查服务状态';
          showToast(errMsg);
        }
      } catch (e) {
        showToast('请求服务失败，请检查服务是否正常运行');
      }
    } else {
      const fileUrl = compressed ? protectedThumbUrl(msg.thumb_path, true) : protectedFileUrl(msg.file_path, true);
      const ext = (compressed ? 'JPG' : (msg.file_name ? msg.file_name.split('.').pop() : '')).toUpperCase();
      const isImg = ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'BMP'].includes(ext);
      if (isImg && navigator.clipboard && window.ClipboardItem) {
        try {
          const resp = await apiFetch(fileUrl);
          const blob = await resp.blob();
          let clipBlob = blob;
          if (blob.type !== 'image/png') {
            clipBlob = await convertBlobToPng(blob);
          }
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipBlob })]);
          showToast('已复制图片到剪贴板');
          return;
        } catch (err) {
          // Fallback to link copy
        }
      }
      copyToClipboard(fileUrl);
      showToast('已复制文件下载链接');
    }
  }

  function convertBlobToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Keep in sync with MediaPreviewExts / TextPreviewExts in server/App.cs
  const PREVIEW_EXTS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.avif',
    '.pdf', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a',
    '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.ini', '.cfg', '.conf', '.toml',
    '.yml', '.yaml', '.xml', '.html', '.htm', '.svg', '.css', '.js', '.ts', '.py', '.java', '.c',
    '.cpp', '.h', '.cs', '.go', '.rs', '.sql', '.tex', '.bib', '.r'
  ]);

  function isBrowserPreviewable(extWithDot) {
    return PREVIEW_EXTS.has((extWithDot || '').toLowerCase());
  }

  function openOnHost(msgId) {
    return revealInFolder(msgId, 'open');
  }

  async function revealInFolder(msgId, mode) {
    try {
      const res = await apiFetch('/api/system/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgId, mode })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        if (mode === 'open') {
          showToast(data.action === 'opened' ? '已用默认程序打开' : '此类型不会直接打开，已在资源管理器中定位');
        } else {
          showToast('已在资源管理器中定位');
        }
      } else {
        showToast('文件未找到或已被移除');
      }
    } catch (e) {
      showToast('无法定位文件');
    }
  }

  function deleteMessage(msgId, isFile = false) {
    const tip = isFile ? '确定删除此文件及本地物理文件吗？' : '确定删除此消息吗？';
    if (confirm(tip)) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'delete', id: msgId }));
      } else {
        apiFetch(`/api/messages?id=${encodeURIComponent(msgId)}`, { method: 'DELETE' });
      }
    }
  }

  if (isMobile) {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.bubble-wrapper')) {
        document.querySelectorAll('.bubble-actions.show').forEach(el => {
          el.classList.remove('show');
        });
      }
    });
  }

  // 9. QR Code Modal
  function setupIpSelector() {
    if (!ipSelect || !ipSwitchBox) return;
    if (allIps.length > 1) {
      ipSwitchBox.style.display = 'block';
      ipSelect.innerHTML = '';
      allIps.forEach(ip => {
        const opt = document.createElement('option');
        opt.value = ip;
        opt.textContent = ip + (ip === lanIp ? ' (推荐 Wi-Fi)' : '');
        if (ip === lanIp) opt.selected = true;
        ipSelect.appendChild(opt);
      });
      ipSelect.onchange = () => {
        renderQrCode(ipSelect.value);
      };
    } else {
      ipSwitchBox.style.display = 'none';
    }
  }

  function renderQrCode(ip) {
    const tokenQuery = pairingToken ? `?token=${encodeURIComponent(pairingToken)}` : '';
    const targetUrl = `http://${ip}:${port}/${tokenQuery}`;
    qrUrlText.textContent = targetUrl;
    const container = document.getElementById('qr-canvas-container');
    container.innerHTML = '';
    try {
      if (window.QRCode) {
        new QRCode(container, {
          text: targetUrl,
          width: 196,
          height: 196,
          colorDark: '#000000',
          colorLight: '#ffffff'
        });
      }
    } catch (err) {
      console.error('QR code generation error:', err);
      container.innerHTML = `<div style="padding:20px;text-align:center;color:#ff4d4f;font-size:12px;">二维码生成异常，请直接在手机浏览器访问:<br><strong style="font-size:14px;color:var(--text-main);">${targetUrl}</strong></div>`;
    }
  }

  async function showQrModal() {
    if (!pairingToken) {
      try {
        const res = await apiFetch('/api/system/info');
        const data = await res.json();
        pairingToken = data.pairing_token || '';
      } catch (err) {
        console.error('Failed to load pairing token', err);
      }
    }
    if (!pairingToken) {
      showToast('无法生成安全配对链接，请重启 LinkFlow 后重试');
      return;
    }
    qrModal.classList.add('open');
    renderQrCode(ipSelect && ipSelect.value ? ipSelect.value : lanIp);
  }

  openQrBtn.addEventListener('click', showQrModal);
  closeQrModal.addEventListener('click', () => qrModal.classList.remove('open'));
  doneQrBtn.addEventListener('click', () => qrModal.classList.remove('open'));

  copyUrlBtn.addEventListener('click', () => {
    copyToClipboard(qrUrlText.textContent);
  });

  // 10. Month Browsing (toolbar)
  function getLocalMonthString(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function updateHistoryBannerCount() {
    if (historyBannerCount) {
      historyBannerCount.textContent = `共 ${allMessages.length} 条`;
    }
  }

  // Months offered by the banner navigator: those with records plus the current month, newest first
  let monthsList = [];
  let monthCounts = {};           // 'YYYY-MM' -> number of records
  let monthSeq = 0;

  async function refreshMonthsList() {
    try {
      const res = await apiFetch('/api/months');
      const data = await res.json();
      if (data.status === 'ok') {
        monthsList = (data.months || []).map(m => m.month);
        monthCounts = Object.fromEntries((data.months || []).map(m => [m.month, m.count]));
      }
    } catch (e) {
      console.error('Failed to refresh months', e);
    }
    const cur = getLocalMonthString(Date.now());
    if (!monthsList.includes(cur)) monthsList.push(cur);
    monthsList.sort().reverse();
  }

  function monthDdItem(value, label, count, selected) {
    return `<button type="button" class="month-dd-item${selected ? ' selected' : ''}" data-value="${value}">` +
      `<span class="month-dd-label">${label}</span><span class="month-dd-count">${count} 条</span></button>`;
  }

  function renderMonthNav(monthStr) {
    if (!monthYearBtn || !monthMonthBtn) return;
    const year = monthStr.slice(0, 4);
    const years = [...new Set(monthsList.map(m => m.slice(0, 4)))];
    const yearCount = y => monthsList.filter(m => m.startsWith(`${y}-`)).reduce((n, m) => n + (monthCounts[m] || 0), 0);
    monthYearBtn.textContent = `${year}年`;
    monthYearList.innerHTML = years.map(y => monthDdItem(y, `${y}年`, yearCount(y), y === year)).join('');
    monthMonthBtn.textContent = `${parseInt(monthStr.slice(5), 10)}月`;
    monthMonthList.innerHTML = monthsList
      .filter(m => m.startsWith(`${year}-`))
      .map(m => monthDdItem(m, `${parseInt(m.slice(5), 10)}月`, monthCounts[m] || 0, m === monthStr)).join('');
    const idx = monthsList.indexOf(monthStr);
    monthPrevBtn.disabled = idx < 0 || idx >= monthsList.length - 1;
    monthNextBtn.disabled = idx <= 0;
    monthCurrentBtn.disabled = monthStr === getLocalMonthString(Date.now());
  }

  function closeMonthDropdowns() {
    monthYearDd.classList.remove('open');
    monthMonthDd.classList.remove('open');
  }

  function bindMonthDropdown(dd, btn, list, onPick) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !dd.classList.contains('open');
      closeMonthDropdowns();
      if (willOpen) {
        dd.classList.add('open');
        const sel = list.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      }
    });
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.month-dd-item');
      if (!item) return;
      closeMonthDropdowns();
      onPick(item.dataset.value);
    });
  }

  if (monthYearBtn) {
    bindMonthDropdown(monthYearDd, monthYearBtn, monthYearList, (year) => {
      const target = monthsList.find(m => m.startsWith(`${year}-`));
      if (target) selectMonth(target);
    });
    bindMonthDropdown(monthMonthDd, monthMonthBtn, monthMonthList, selectMonth);
    document.addEventListener('click', closeMonthDropdowns);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMonthDropdowns(); });
    monthPrevBtn.addEventListener('click', () => {
      const i = monthsList.indexOf(currentViewMonth);
      if (i >= 0 && i < monthsList.length - 1) selectMonth(monthsList[i + 1]);
    });
    monthNextBtn.addEventListener('click', () => {
      const i = monthsList.indexOf(currentViewMonth);
      if (i > 0) selectMonth(monthsList[i - 1]);
    });
    monthCurrentBtn.addEventListener('click', () => selectMonth(getLocalMonthString(Date.now())));
  }

  async function selectMonth(monthStr) {
    const seq = ++monthSeq;
    try {
      const [res] = await Promise.all([
        apiFetch(`/api/messages?month=${encodeURIComponent(monthStr)}`),
        refreshMonthsList()
      ]);
      const data = await res.json();
      if (seq !== monthSeq) return;
      if (data.status === 'ok') {
        currentViewMonth = monthStr;
        allMessages = data.messages || [];
        resetSearchText();
        renderMessages(allMessages);
        updateToolbarState();
        renderMonthNav(monthStr);
        updateHistoryBannerCount();
        if (historyBanner) historyBanner.style.display = 'flex';
      } else {
        showToast('获取该月记录失败');
        if (currentViewMonth) renderMonthNav(currentViewMonth);
      }
    } catch (err) {
      console.error('Failed to select month', err);
      showToast('载入失败，请重试');
      if (currentViewMonth) renderMonthNav(currentViewMonth);
    }
  }

  async function exitHistoryMode() {
    if (currentViewMonth === null) return;
    monthSeq++;
    currentViewMonth = null;
    updateToolbarState();
    if (historyBanner) historyBanner.style.display = 'none';
    showToast('正在切回实时消息...');
    try {
      const res = await apiFetch(`/api/messages?limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (data.status === 'ok') {
        resetSearchText();
        applyLiveMessages(data.messages);
        showToast('已切回实时最新消息');
        fillIfShort();
      }
    } catch (err) {
      console.error('Failed to exit history mode', err);
    }
  }

  if (openCalendarBtn) {
    // Opens the month toolbar on the current month; while it is open, clicking again goes back to live
    openCalendarBtn.addEventListener('click', () => {
      if (currentViewMonth) {
        exitHistoryMode();
        return;
      }
      selectMonth(getLocalMonthString(Date.now()));
    });
  }

  // Highlights the header toggle buttons while their mode is on
  function updateToolbarState() {
    if (openCalendarBtn) openCalendarBtn.classList.toggle('active', !!currentViewMonth);
    if (toggleSearchBtn) toggleSearchBtn.classList.toggle('active', searchBar.classList.contains('active'));
  }

  // Switching between live view and a month drops the old query (its results are gone)
  function resetSearchText() {
    searchInput.value = '';
    searchSeq++;
    clearTimeout(searchTimer);
  }

  if (exitHistoryBtn) {
    exitHistoryBtn.addEventListener('click', exitHistoryMode);
  }

  // Close modals on clicking outside mask
  window.addEventListener('click', (e) => {
    if (qrModal && e.target === qrModal) qrModal.classList.remove('open');
    if (settingsModal && e.target === settingsModal) settingsModal.classList.remove('open');
  });

  // 11. Settings Modal
  openSettingsBtn.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/system/info');
      const data = await res.json();
      if (data.status === 'ok') {
        updateStorageStats(data.stats);
      }
    } catch (e) {}
    settingsModal.classList.add('open');
  });

  closeSettingsModal.addEventListener('click', () => settingsModal.classList.remove('open'));

  settingAutoClipboard.addEventListener('change', async (e) => {
    autoClipboard = e.target.checked;
    try {
      const res = await apiFetch('/api/system/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_clipboard: autoClipboard })
      });
      if (!res.ok) throw new Error(`Settings update failed: ${res.status}`);
      showToast(autoClipboard ? '已开启剪贴板自动同步' : '已关闭剪贴板自动同步');
    } catch (err) {
      autoClipboard = !autoClipboard;
      e.target.checked = autoClipboard;
      showToast('只有电脑端可以修改此设置');
      console.error(err);
    }
  });

  clearAllBtn.addEventListener('click', async () => {
    if (confirm('确定清空所有历史记录和文件吗？此操作无法撤销。')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear_all' }));
      } else {
        await apiFetch('/api/messages', { method: 'DELETE' });
      }
      settingsModal.classList.remove('open');
    }
  });

  // 12. Lightbox Image
  function openLightbox(src) {
    lightboxImg.src = src;
    lightboxMask.classList.add('open');
  }

  lightboxMask.addEventListener('click', () => {
    lightboxMask.classList.remove('open');
  });

  // 13. Search Filtering
  // The search bar sits above the timeline in the layout. Keep the messages at the bottom where
  // they are when it opens/closes, so it looks like the bar covers the top instead of pushing content.
  function setSearchBarOpen(open) {
    const before = chatHistory.clientHeight;
    searchBar.classList.toggle('active', open);
    const delta = before - chatHistory.clientHeight;
    if (delta) chatHistory.scrollTo({ top: chatHistory.scrollTop + delta, behavior: 'instant' });
  }

  function closeSearch() {
    setSearchBarOpen(false);
    searchInput.value = '';
    searchSeq++;
    clearTimeout(searchTimer);
    renderMessages(allMessages);
    updateToolbarState();
  }

  toggleSearchBtn.addEventListener('click', () => {
    if (searchBar.classList.contains('active')) {
      closeSearch();
    } else {
      setSearchBarOpen(true);
      searchInput.focus();
      updateToolbarState();
    }
  });

  closeSearchBtn.addEventListener('click', closeSearch);

  // Search runs on the server so it covers records that are not loaded in the timeline
  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.trim();
    const seq = ++searchSeq;
    clearTimeout(searchTimer);
    if (!keyword) {
      renderMessages(allMessages);
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const monthArg = currentViewMonth ? `&month=${encodeURIComponent(currentViewMonth)}` : '';
        const res = await apiFetch(`/api/messages?search=${encodeURIComponent(keyword)}&limit=${SEARCH_LIMIT}${monthArg}`);
        const data = await res.json();
        if (seq !== searchSeq || data.status !== 'ok') return;
        renderMessages(data.messages || []);
      } catch (err) {
        console.error('Search failed', err);
      }
    }, 250);
  });

  // 14. Toast helper
  let toastTimer = null;
  function showToast(text) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // 15. Single-Instance & Duplicate Tab Coordination
  const currentTabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  let isMasterTab = false;
  let broadcastChannel = null;
  let isDuplicateSuppressed = false;

  let titleFlashTimer = null;
  function triggerTabWakeNotice() {
    try {
      window.focus();
    } catch (e) {}

    const originalTitle = '文件传输助手';
    let count = 0;
    if (titleFlashTimer) clearInterval(titleFlashTimer);
    titleFlashTimer = setInterval(() => {
      count++;
      if (count % 2 === 1) {
        document.title = '🔔【已在此打开】文件传输助手';
      } else {
        document.title = originalTitle;
      }
      if (count >= 6) {
        clearInterval(titleFlashTimer);
        titleFlashTimer = null;
        document.title = originalTitle;
      }
    }, 450);

    showToast('已为您唤醒文件传输助手');
  }

  function handleDuplicateTabDetected() {
    if (isDuplicateSuppressed) return;
    isDuplicateSuppressed = true;

    // Keep the newly opened tab visible. Browser-launched tabs may otherwise close
    // immediately, while the existing LinkFlow tab remains hidden in another window.
    showDuplicateModal();
  }

  function showDuplicateModal() {
    let dupMask = document.getElementById('duplicate-modal');
    if (!dupMask) {
      dupMask = document.createElement('div');
      dupMask.id = 'duplicate-modal';
      dupMask.className = 'duplicate-mask';
      dupMask.innerHTML = `
        <div class="duplicate-box">
          <div class="duplicate-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 7.5 8 3v18"></path>
              <path d="M16 3v18l4.5-4.5"></path>
            </svg>
          </div>
          <div class="duplicate-title">文件传输助手已在运行</div>
          <div class="duplicate-desc">
            检测到当前浏览器中已有正在运行的文件传输助手。<br>
            为避免重复占用内存及多标签堆积，请直接切换回已打开的标签页。
          </div>
          <div class="duplicate-actions">
            <button id="close-duplicate-btn" class="dup-btn dup-btn-primary">关闭当前标签页</button>
            <button id="stay-duplicate-btn" class="dup-btn dup-btn-secondary">仍在此标签页使用</button>
          </div>
        </div>
      `;
      document.body.appendChild(dupMask);

      document.getElementById('close-duplicate-btn').addEventListener('click', () => {
        window.close();
        setTimeout(() => {
          showToast('若浏览器限制关闭，请直接点击顶部标签栏 ✕ 关闭');
        }, 300);
      });

      document.getElementById('stay-duplicate-btn').addEventListener('click', () => {
        dupMask.style.display = 'none';
        isDuplicateSuppressed = false;
        isMasterTab = true;
        if (broadcastChannel) {
          broadcastChannel.postMessage({ type: 'CLAIM_MASTER', tabId: currentTabId });
        }
        showToast('已切换至当前标签页为主界面');
      });
    } else {
      dupMask.style.display = 'flex';
    }
  }

  function initSingleInstance() {
    if (typeof BroadcastChannel === 'undefined') {
      isMasterTab = true;
      return;
    }

    broadcastChannel = new BroadcastChannel('linkflow_single_instance');

    broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'QUERY_INSTANCE') {
        if (isMasterTab || document.visibilityState === 'visible') {
          broadcastChannel.postMessage({
            type: 'INSTANCE_EXISTS',
            primaryTabId: currentTabId,
            targetTabId: data.tabId
          });
          triggerTabWakeNotice();
        }
      } else if (data.type === 'INSTANCE_EXISTS' && data.targetTabId === currentTabId) {
        handleDuplicateTabDetected();
      } else if (data.type === 'CLAIM_MASTER') {
        if (data.tabId !== currentTabId) {
          isMasterTab = false;
        }
      }
    };

    let hasResponded = false;
    const checkTimer = setTimeout(() => {
      if (!hasResponded) {
        isMasterTab = true;
        broadcastChannel.postMessage({ type: 'CLAIM_MASTER', tabId: currentTabId });
      }
    }, 280);

    const onInitialCheck = (event) => {
      if (event.data && event.data.type === 'INSTANCE_EXISTS' && event.data.targetTabId === currentTabId) {
        hasResponded = true;
        clearTimeout(checkTimer);
        broadcastChannel.removeEventListener('message', onInitialCheck);
        handleDuplicateTabDetected();
      }
    };

    broadcastChannel.addEventListener('message', onInitialCheck);
    broadcastChannel.postMessage({ type: 'QUERY_INSTANCE', tabId: currentTabId });

    window.addEventListener('focus', () => {
      if (!isDuplicateSuppressed) {
        isMasterTab = true;
        broadcastChannel.postMessage({ type: 'CLAIM_MASTER', tabId: currentTabId });
      }
    });
  }

  // Initialize
  initSingleInstance();
  loadInitialData();
  connectWebSocket();
})();
