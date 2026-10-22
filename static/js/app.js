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

  const INPUT_BASE_H = isMobile ? 44 : 56;

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
  let wifiName = '';
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
    return isMobile ? '移动设备' : '电脑';
  }

  // The Android app keeps the name natively: localStorage is per origin, so a new host address
  // (new IP after re-pairing) would otherwise start from an empty store and lose the custom name.
  function savedDeviceName() {
    let saved = '';
    try { saved = (window.LinkFlowNative && window.LinkFlowNative.getDeviceName()) || ''; } catch (e) { /* bridge unavailable */ }
    if (saved) return saved;
    try { saved = localStorage.getItem('linkflow_device_name') || ''; } catch (e) { /* storage unavailable */ }
    if (saved) storeDeviceName(saved);
    return saved;
  }

  function storeDeviceName(name) {
    try { window.LinkFlowNative && window.LinkFlowNative.setDeviceName(name); } catch (e) { /* bridge unavailable */ }
    try {
      if (name) localStorage.setItem('linkflow_device_name', name);
      else localStorage.removeItem('linkflow_device_name');
    } catch (e) { /* storage unavailable */ }
  }

  function getDeviceName() {
    return savedDeviceName() || (isHost && hostName ? hostName : guessDeviceName());
  }

  function deviceIcon(msg) {
    const kind = msg.device_kind || (msg.sender === 'phone' ? 'mobile' : 'computer');
    return window.LinkFlowIcons.svg(kind === 'mobile' ? 'mobile' : kind === 'desktop' ? 'desktop' : 'computer', 24, 1.8);
  }

  function senderLabel(msg) {
    return msg.device_name || (msg.sender === 'phone' ? '其他设备' : '电脑');
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
  let timelineSeq = 0;
  let loadingView = false;
  let olderController = null;
  let viewController = null;
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

  // Modals
  const qrModal = document.getElementById('qr-modal');
  const closeQrModal = document.getElementById('close-qr-modal');
  const qrUrlText = document.getElementById('qr-url-text');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const ipSelect = document.getElementById('ip-select');
  const ipSwitchBox = document.getElementById('ip-switch-box');

  const settingsModal = document.getElementById('settings-modal');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const closeSettingsModal = document.getElementById('close-settings-modal');
  const settingDarkTheme = document.getElementById('setting-dark-theme');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const storageStatsText = document.getElementById('storage-stats-text');
  const appVersionText = document.getElementById('app-version-text');

  const lightboxMask = document.getElementById('lightbox-mask');
  const lightboxImg = document.getElementById('lightbox-img');

  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const closeSearchBtn = document.getElementById('close-search-btn');

  const fileInput = document.getElementById('file-input');
  const mediaInput = document.getElementById('media-input');
  const cameraInput = document.getElementById('camera-input');

  function applyHostCapabilities() {
    const clearRow = document.getElementById('clear-all-row');
    if (clearRow) clearRow.hidden = !isHost;
    else if (clearAllBtn) clearAllBtn.hidden = !isHost;
  }

  applyHostCapabilities();

  // Theme initialization
  const themeColorMeta = document.getElementById('theme-color-meta');
  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (themeColorMeta) themeColorMeta.content = isMobile ? '#14171f' : '#1f1f1f';
      if (settingDarkTheme) settingDarkTheme.checked = true;
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeColorMeta) themeColorMeta.content = isMobile ? '#f3f2fa' : '#f7f7f7';
      if (settingDarkTheme) settingDarkTheme.checked = false;
    }
    syncWindowChrome();
  }

  // Tells the desktop window (WebView2 host) which colours the native title bar should use, so it blends with the page.
  function syncWindowChrome() {
    try {
      if (!(window.chrome && window.chrome.webview)) return;
      const css = getComputedStyle(document.documentElement);
      const ctx = document.createElement('canvas').getContext('2d');
      const hex = (value) => { ctx.fillStyle = '#000000'; ctx.fillStyle = value.trim(); return ctx.fillStyle; };
      window.chrome.webview.postMessage({
        type: 'chrome',
        bg: hex(css.getPropertyValue('--bg-chat')),
        fg: hex(css.getPropertyValue('--text-main')),
        dark: document.documentElement.getAttribute('data-theme') === 'dark'
      });
    } catch (e) { /* not inside the desktop window */ }
  }

  const savedTheme = localStorage.getItem('linkflow_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme === 'dark' || (!savedTheme && prefersDark));

  settingDarkTheme.addEventListener('change', (e) => {
    applyTheme(e.target.checked);
    localStorage.setItem('linkflow_theme', e.target.checked ? 'dark' : 'light');
  });
  const settingDarkRow = document.getElementById('setting-dark-row');
  if (settingDarkRow) settingDarkRow.addEventListener('click', () => {
    settingDarkTheme.checked = !settingDarkTheme.checked;
    settingDarkTheme.dispatchEvent(new Event('change'));
  });

  // Device name: looks like plain text; tap it to edit in place. Enter or tapping elsewhere saves, Esc cancels.
  const deviceNameInput = document.getElementById('setting-device-name-text');
  function refreshDeviceNameText() {
    if (deviceNameInput && document.activeElement !== deviceNameInput) deviceNameInput.value = getDeviceName();
  }
  function commitDeviceName() {
    const name = deviceNameInput.value.trim();
    if (name && name !== getDeviceName()) {
      storeDeviceName(name);
      showToast('设备名称已更新');
    }
    deviceNameInput.value = getDeviceName();
  }
  deviceNameInput.addEventListener('blur', commitDeviceName);
  deviceNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); deviceNameInput.blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); deviceNameInput.value = getDeviceName(); deviceNameInput.blur(); }
  });
  document.getElementById('device-name-row').addEventListener('click', (e) => {
    if (e.target !== deviceNameInput) deviceNameInput.focus();
  });
  refreshDeviceNameText();

  // 3. WebSocket Connection
  // Connection state shown in the header: connecting / connected / retrying / unpaired.
  const LONG_DISCONNECT_MS = 30000;
  let disconnectedSince = 0;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  // Back off while the host is unreachable (2.5s, 5s, then 10s) instead of retrying every 2.5s forever.
  const RECONNECT_DELAYS_MS = [2500, 5000, 10000];
  let liveSyncRunning = false;
  let deferredLiveEvents = [];

  function setConnState(state) {
    window.LinkFlowServerOnline = state === 'connected';
    window.LinkFlowDownloads?.apply();
    statusDot.classList.remove('online', 'retrying', 'unpaired');
    if (state === 'connected') {
      statusDot.classList.add('online');
      // Non-host devices (phone, tablet, other computers) connect to the host PC.
      statusText.textContent = isHost ? '已连接设备' : '已连接电脑';
    } else if (state === 'retrying') {
      statusDot.classList.add('retrying');
      const long = !isHost && disconnectedSince && Date.now() - disconnectedSince > LONG_DISCONNECT_MS;
      statusText.textContent = long ? '已断开，请确认与电脑在同一 Wi-Fi' : '已断开，重连中…';
    } else if (state === 'unpaired') {
      statusDot.classList.add('unpaired');
      statusText.textContent = '配对已失效，请重新扫码';
    } else {
      statusText.textContent = '正在连接…';
    }
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    const wsUrl = `${protocol}//${location.host}/ws${tokenQuery}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      disconnectedSince = 0;
      reconnectAttempts = 0;
      setConnState('connected');
      loadInitialData();
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
      if (authToken || isHost) {
        if (!disconnectedSince) disconnectedSince = Date.now();
        setConnState('retrying');
      } else {
        setConnState('unpaired');
      }
      clearTimeout(reconnectTimer);
      // A hidden page does not retry: resumeSync reconnects as soon as it becomes visible again.
      if (document.visibilityState === 'hidden') return;
      const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempts++;
      reconnectTimer = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error', err);
    };
  }

  function handleIncomingWS(data) {
    if (liveSyncRunning && ['new_message', 'message_deleted', 'messages_cleared'].includes(data.type)) {
      deferredLiveEvents.push(data);
      return;
    }
    if (data.type === 'peer_connected') {
      if (isHost) qrModal.classList.remove('open');
      return;
    }
    if (data.type === 'file_receiving') {
      if (!isHost) return;
      let row = document.getElementById(`msg-${data.message.id}`);
      if (!row) { appendMessageToUI(data.message); row = document.getElementById(`msg-${data.message.id}`); }
      const card = row.querySelector('.file-card');
      card.classList.toggle('download-active', data.status === 'running');
      card.classList.toggle('download-failed', data.status === 'failed');
      card.style.setProperty('--download-progress', `${Math.max(0, Math.min(99, data.percent))}%`);
      let label = card.querySelector('.download-status');
      if (!label) { label = document.createElement('div'); label.className = 'download-status'; card.querySelector('.file-info').appendChild(label); }
      label.textContent = data.status === 'failed' ? `接收失败 · ${data.detail || '请重试'}` : data.percent >= 0 ? `接收中 ${data.percent}%` : '正在接收…';
      return;
    }
    if (data.type === 'connected') {
      lanIp = data.lan_ip || location.hostname;
      port = data.port || location.port;
      autoClipboard = data.auto_clipboard;
      if (typeof data.is_host === 'boolean') {
        const oldIsHost = isHost;
        isHost = data.is_host;
        if (oldIsHost !== isHost && allMessages.length > 0) {
          renderMessages(allMessages);
        }
        applyHostCapabilities();
        setConnState('connected');
      }
    } else if (data.type === 'new_message') {
      if (data.transfer_id) document.getElementById(`msg-${data.transfer_id}`)?.remove();
      const msg = data.message;
      const msgMonth = getLocalMonthString(msg.timestamp);
      if (monthCounts[msgMonth] !== undefined && !allMessages.some(m => m.id === msg.id)) monthCounts[msgMonth]++;
      if (isHost && msg.msg_type !== 'text') showToast(`已接收：${msg.file_name}`);
      if (window.LinkFlowAndroid && msg.msg_type !== 'text' && msg.sender === 'pc') window.location.href = 'linkflow://receive';
      if (currentViewMonth) {
        if (msgMonth === currentViewMonth) {
          if (searchInput.value.trim()) {
            if (!allMessages.some(m => m.id === msg.id)) allMessages.push(msg);
            searchInput.dispatchEvent(new Event('input'));
          } else appendLiveMessage(msg);
          updateHistoryBannerCount();
        } else {
          showToast('有新消息，请返回实时消息查看');
        }
      } else {
        if (searchInput.value.trim()) {
          if (!allMessages.some(m => m.id === msg.id)) allMessages.push(msg);
          searchInput.dispatchEvent(new Event('input'));
        } else appendLiveMessage(msg);
      }
    } else if (data.type === 'message_deleted') {
      const deleted = allMessages.find(m => m.id === data.id);
      const deletedMonth = deleted && getLocalMonthString(deleted.timestamp);
      if (deletedMonth && monthCounts[deletedMonth] !== undefined) monthCounts[deletedMonth] = Math.max(0, monthCounts[deletedMonth] - 1);
      const row = document.getElementById(`msg-${data.id}`);
      if (row) row.remove();
      allMessages = allMessages.filter(m => m.id !== data.id);
      if (currentViewMonth) {
        if (deleted) updateHistoryBannerCount();
        else refreshMonthsList().then(updateHistoryBannerCount);
      }
    } else if (data.type === 'messages_cleared') {
      cancelTimelineRequests();
      chatHistory.innerHTML = '';
      allMessages = [];
      monthCounts = {};
      hasMoreOlder = false;
      if (currentViewMonth) exitHistoryMode();
      showToast('聊天记录已清空');
    } else if (data.type === 'wake_tab') {
      triggerTabWakeNotice();
    } else if (data.type === 'error') {
      showToast(data.error || '操作未完成', true);
    }
  }

  // 4. REST API & Initial Load
  async function loadInitialData() {
    if (liveSyncRunning) return;
    liveSyncRunning = true;
    const seq = timelineSeq;
    try {
      const [msgRes, infoRes] = await Promise.all([
        apiFetch(`/api/messages?limit=${PAGE_SIZE}`, { signal: AbortSignal.timeout(15000) }),
        apiFetch('/api/system/info', { signal: AbortSignal.timeout(15000) })
      ]);

      if (msgRes.status === 401 || infoRes.status === 401) {
        setConnState('unpaired');
        return;
      }

      const msgData = await msgRes.json();
      if (seq === timelineSeq && msgData.status === 'ok' && !currentViewMonth && !searchInput.value.trim()) {
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
        wifiName = infoData.wifi_name || '';
        updateQrHint();
        hostKind = infoData.host_kind || '';
        if (infoData.pairing_token) pairingToken = infoData.pairing_token;
        if (appVersionText && (window.LinkFlowAppVersion || infoData.version)) {
          appVersionText.textContent = `LinkFlow v${window.LinkFlowAppVersion || infoData.version}`;
        }
        if (typeof infoData.is_host === 'boolean') {
          const oldIsHost = isHost;
          isHost = infoData.is_host;
          if (oldIsHost !== isHost && allMessages.length > 0) {
            renderMessages(allMessages);
          }
          applyHostCapabilities();
        }
        refreshDeviceNameText();
        updateStorageStats(infoData.stats);
        setupIpSelector();
      }
      fillIfShort();
      if (window.LinkFlowAndroid) window.location.href = 'linkflow://receive';
    } catch (e) {
      console.error('Failed to load initial data', e);
    } finally {
      liveSyncRunning = false;
      const events = deferredLiveEvents;
      deferredLiveEvents = [];
      events.forEach(handleIncomingWS);
    }
  }

  function resumeSync() {
    if (document.visibilityState === 'hidden') return;
    // A suspended WebView may retain an OPEN socket which is no longer alive.
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    reconnectAttempts = 0;
    connectWebSocket();
    if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
    else if (currentViewMonth) selectMonth(currentViewMonth);
  }
  document.addEventListener('visibilitychange', resumeSync);
  window.addEventListener('online', resumeSync);
  window.addEventListener('pageshow', resumeSync);
  window.addEventListener('linkflow-resume', resumeSync);

  function applyLiveMessages(messages) {
    allMessages = messages || [];
    hasMoreOlder = allMessages.length >= PAGE_SIZE;
    renderMessages(allMessages);
  }

  function cancelTimelineRequests() {
    timelineSeq++;
    olderController?.abort();
    viewController?.abort();
    olderController = viewController = null;
    loadingOlder = loadingView = false;
    return timelineSeq;
  }

  // Prepends the next older page, keeping the viewport where it was.
  async function loadOlderMessages() {
    if (loadingOlder || loadingView || searchInput.value.trim() || !hasMoreOlder || allMessages.length === 0) return false;
    loadingOlder = true;
    const seq = timelineSeq;
    const controller = olderController = new AbortController();
    try {
      const first = allMessages[0];
      const monthArg = currentViewMonth ? `&month=${encodeURIComponent(currentViewMonth)}` : '';
      const res = await apiFetch(`/api/messages?limit=${PAGE_SIZE}&before_ts=${encodeURIComponent(first.timestamp)}&before_id=${encodeURIComponent(first.id)}${monthArg}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const data = await res.json();
      if (seq !== timelineSeq || data.status !== 'ok') return false;
      const page = data.messages || [];
      const ids = new Set(allMessages.map(m => m.id));
      const older = page.filter(m => !ids.has(m.id));
      hasMoreOlder = page.length >= PAGE_SIZE;
      prependMessages(older);
      allMessages = older.concat(allMessages);
      if (!older.length) updateTopHint();
      return older.length > 0;
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Failed to load older messages', e);
      return false;
    } finally {
      if (olderController === controller) { olderController = null; loadingOlder = false; }
    }
  }

  // A short page may not fill the screen, so there would be nothing to scroll up from.
  async function fillIfShort() {
    while (!loadingView && !searchInput.value.trim() && hasMoreOlder && chatHistory.scrollHeight <= chatHistory.clientHeight + 40) {
      if (!(await loadOlderMessages())) break;
    }
  }

  chatHistory.addEventListener('scroll', () => {
    if (chatHistory.scrollTop < 80 && !searchInput.value.trim()) loadOlderMessages();
  }, { passive: true });

  let storageStats = null;
  function updateStorageStats(stats) {
    if (!stats || !storageStatsText) return;
    storageStats = stats;
    const mb = (stats.total_file_size / (1024 * 1024)).toFixed(1);
    storageStatsText.textContent = `${stats.total_messages} 条记录 · ${mb} MB`;
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
    if (allMessages.some(existing => existing.id === msg.id)) return;
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
    if (messages === allMessages) updateTopHint();

    messages.forEach(msg => {
      const day = new Date(msg.timestamp).toDateString();
      if (day !== lastDate) {
        const divider = document.createElement('div');
        divider.className = 'timeline-date-divider';
        divider.textContent = formatDateHeader(msg.timestamp);
        chatHistory.appendChild(divider);
        lastDate = day;
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

  function updateTopHint() {
    chatHistory.querySelector('.timeline-top-hint')?.remove();
    if (hasMoreOlder || !allMessages.length || searchInput.value.trim()) return;
    const hint = document.createElement('div');
    hint.className = 'timeline-date-divider timeline-top-hint';
    hint.textContent = currentViewMonth ? '没有更早的本月记录了' : '没有更早的记录了';
    chatHistory.prepend(hint);
  }

  function prependMessages(messages) {
    if (!messages.length) return;
    const prevHeight = chatHistory.scrollHeight;
    const prevTop = chatHistory.scrollTop;
    const fragment = document.createDocumentFragment();
    let lastDay = '';
    for (const msg of messages) {
      const day = new Date(msg.timestamp).toDateString();
      if (day !== lastDay) {
        const divider = document.createElement('div');
        divider.className = 'timeline-date-divider';
        divider.textContent = formatDateHeader(msg.timestamp);
        fragment.appendChild(divider);
        lastDay = day;
      }
      appendMessageToUI(msg, false, fragment);
    }
    chatHistory.querySelector('.timeline-top-hint')?.remove();
    if (allMessages.length && lastDay === new Date(allMessages[0].timestamp).toDateString()) {
      const divider = chatHistory.firstElementChild;
      if (divider?.classList.contains('timeline-date-divider')) divider.remove();
    }
    chatHistory.prepend(fragment);
    updateTopHint();
    chatHistory.scrollTo({ top: prevTop + chatHistory.scrollHeight - prevHeight, behavior: 'instant' });
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

  // '📋 复制' -> small line icon + text, for the desktop hover bar.
  function menuLabelHtml(label) {
    const [emoji, ...rest] = label.split(' ');
    const name = window.LinkFlowIcons.BY_EMOJI[emoji];
    return name ? `${window.LinkFlowIcons.svg(name, 14)}<span>${rest.join(' ')}</span>` : label;
  }

  function appendMessageToUI(msg, autoScroll = true, target = chatHistory) {
    const isSelf = (msg.sender === currentDevice());
    const row = document.createElement('div');
    row.id = `msg-${msg.id}`;
    row.className = `message-row sender-${msg.sender} ${isSelf ? 'is-current-device' : 'is-peer-device'}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'sender-avatar';
    // Phone icon for phones and tablets, desktop or laptop icon for computers.
    avatar.innerHTML = deviceIcon(msg);

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
    const isImage = msg.msg_type !== 'text' && /\.(jpe?g|png|gif|webp|bmp|svg|heic|ico|avif)$/i.test(msg.file_name || '');
    const hostImage = isHost && (isImage || hasThumb);
    const menuItems = [];
    const addAction = (label, handler) => {
      menuItems.push({ label, handler });
      const btn = document.createElement('button');
      btn.className = 'action-btn-mini';
      btn.innerHTML = menuLabelHtml(label);
      btn.onclick = (e) => {
        e.stopPropagation();
        handler();
      };
      actions.appendChild(btn);
    };

    if (hostImage) {
      if (hasThumb) addAction('📋 复制原图', () => copyMessage(msg, false));
      addAction('📁 定位', () => revealInFolder(msg.id));
    } else {
      if (!isHost && msg.msg_type !== 'text') {
        addAction('🔗 复制链接', () => { copyToClipboard(protectedFileUrl(msg.file_path, true)); showToast('已复制文件链接'); });
        addAction('⬇️ 重新接收', () => window.LinkFlowDownloads.action('redownload', protectedFileUrl(msg.file_path)));
        if (hasThumb) addAction('⬇️ 接收压缩图', () => window.LinkFlowDownloads.action('receive', protectedThumbUrl(msg.thumb_path)));
      } else {
        addAction(hasThumb ? '📋 复制压缩图' : '📋 复制', () => copyMessage(msg, hasThumb));
        if (hasThumb) addAction('📋 复制原图', () => copyMessage(msg, false));
      }
    }

    const isFileMsg = (msg.msg_type !== 'text');
    if (isMobile && !isFileMsg) {
      menuItems.push({ label: '✂️ 选择文字', handler: () => {
        const bubbleEl = bubbleWrapper.querySelector('.bubble');
        if (!bubbleEl) return;
        bubbleEl.classList.add('selectable');
        const range = document.createRange();
        range.selectNodeContents(bubbleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.addEventListener('click', () => bubbleEl.classList.remove('selectable'), { once: true });
      } });
    }
    menuItems.push({ label: '🗑️ 删除', handler: () => deleteMessage(msg.id, isFileMsg) });
    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn-mini';
    delBtn.innerHTML = menuLabelHtml('🗑️ 删除');
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
      const fileKind = window.LinkFlowIcons.fileType(ext);
      const icon = window.LinkFlowIcons.fileEmoji(fileKind);

      const { baseName, ext: fileExtWithDot } = splitFileName(msg.file_name || 'file');
      bubble.dataset.fileUrl = protectedFileUrl(msg.file_path);
      bubble.dataset.hostReceived = String(isHost && !msg.receiving);
      bubble.dataset.receiving = String(!!msg.receiving);
      // A file this device sent has nothing to receive here.
      bubble.dataset.own = String(isSelf);

      bubble.innerHTML = `
        <div class="file-icon-box"><span class="file-icon ft-${fileKind}" aria-hidden="true">${icon}</span><span class="file-ext-label">${escapeHtml(ext)}</span></div>
        <div class="file-info">
          <a class="file-name" href="${protectedFileUrl(msg.file_path)}" target="${isHost ? '_blank' : '_self'}" rel="noopener noreferrer" title="${escapeHtml(msg.file_name || '')}"><span class="file-name-base">${escapeHtml(baseName)}</span><span class="file-name-ext">${escapeHtml(fileExtWithDot)}</span></a>
          ${msg.thumb_path
            ? `<a class="file-meta file-thumb-link" href="${protectedFileUrl(msg.file_path)}" target="_blank" rel="noopener noreferrer" title="查看原图">原图 · ${formatFileSize(msg.file_size)}</a>`
            : `<div class="file-meta">${formatFileSize(msg.file_size)}</div>`}
          ${msg.thumb_path ? `<a class="file-meta file-thumb-link" href="${protectedThumbUrl(msg.thumb_path)}" target="_blank" rel="noopener noreferrer" title="查看压缩图">压缩图 · ${formatFileSize(msg.thumb_size)}</a>` : ''}
        </div>
        <div class="file-ops">
          ${hostImage ? `<button class="file-op-btn copy-image-btn" title="${hasThumb ? '复制压缩图' : '复制原图'}" aria-label="${hasThumb ? '复制压缩图' : '复制原图'}">${window.LinkFlowIcons.svg('copy', 18)}</button>` : isHost ? `<button class="file-op-btn open-folder-btn" title="在文件夹中定位" aria-label="在文件夹中定位">${window.LinkFlowIcons.svg('folder', 18)}</button>` : isSelf ? '' : `<a class="file-op-btn" href="${protectedFileUrl(msg.file_path)}" download="${escapeHtml(msg.file_name || '')}" title="下载保存" aria-label="下载保存">${window.LinkFlowIcons.svg('receive', 18)}</a>`}
        </div>
      `;
      if (msg.receiving) {
        actions.hidden = true;
        bubble.querySelectorAll('a').forEach(link => { link.removeAttribute('href'); link.removeAttribute('target'); });
        bubble.querySelector('.file-ops')?.remove();
      } else if (isHost) {
        bubble.classList.add('download-complete');
        bubble.style.setProperty('--download-progress', '100%');      }
      if (!isHost && isImage) {
        bubble.querySelectorAll('.file-name, .file-thumb-link').forEach(link => {
          link.addEventListener('click', event => {
            event.preventDefault();
            if (window.LinkFlowAndroid && window.LinkFlowServerOnline === false && window.LinkFlowDownloads.isReceived(link.href)) {
              window.LinkFlowDownloads.action('open', link.href);
              return;
            }
            openLightbox(link.href);
          });
        });
      }
      if (isHost && !msg.receiving) {
        const btn = bubble.querySelector('.open-folder-btn');
        if (btn) btn.onclick = () => revealInFolder(msg.id);
        const copyImage = bubble.querySelector('.copy-image-btn');
        if (copyImage) copyImage.onclick = () => copyMessage(msg, hasThumb);
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
      // Phones have no hover: long-press a message to get its actions in a sheet; a tap does nothing.
      bubbleWrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openActionSheet(menuItems, bubbleWrapper);
      });
    }

    bodyWrap.appendChild(bubbleWrapper);

    row.appendChild(avatar);
    row.appendChild(bodyWrap);
    target.appendChild(row);
    window.LinkFlowDownloads?.apply(row);

    if (autoScroll) {
      scrollToBottom();
    }
  }

  const sheetIcon = (name) => window.LinkFlowIcons.svg(name, 22);

  // Menu labels start with an emoji only as a key; every surface draws the matching line icon from icons.js.
  const EMOJI_ICON = window.LinkFlowIcons.BY_EMOJI;
  function openActionSheet(items, anchor) {
    document.querySelector('.action-sheet-mask')?.remove();
    const mask = document.createElement('div');
    mask.className = 'action-sheet-mask';
    const sheet = document.createElement('div');
    sheet.className = 'action-sheet';
    sheet.style.visibility = 'hidden';
    const close = () => mask.remove();
    for (const item of items) {
      const [emoji, ...rest] = item.label.split(' ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = sheetIcon(EMOJI_ICON[emoji]) + `<span>${rest.join(' ') || item.label}</span>`;
      btn.onclick = () => { close(); item.handler(); };
      sheet.appendChild(btn);
    }
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    mask.appendChild(sheet);
    document.body.appendChild(mask);
    // Centre the sheet vertically on the pressed card, kept inside the screen.
    const rect = anchor ? anchor.getBoundingClientRect() : null;
    const center = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const top = Math.min(Math.max(12, center - sheet.offsetHeight / 2), window.innerHeight - sheet.offsetHeight - 12);
    sheet.style.top = `${top}px`;
    sheet.style.visibility = '';
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
      messageInput.style.height = INPUT_BASE_H + 'px';
      messageInput.style.overflowY = 'hidden';
      window.LinkFlowSendMode?.();
    } else {
      showToast('已断开，正在重连…');
    }
  }

  sendBtn.addEventListener('click', () => {
    // Phone: the button is "+" while the box is empty (attachments) and turns into send once there is text.
    if (isMobile && !messageInput.value.trim()) { window.LinkFlowAttachMenu?.(); return; }
    sendTextMessage();
  });

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
    const baseH = INPUT_BASE_H;
    const maxH = isMobile ? 120 : 160;
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
        showToast(`${file.name} 超过 ${formatFileSize(maxUploadBytes)} 上传上限`, true);
        continue;
      }
      if (total > 1) {
        showToast(`正在传输 (${i + 1}/${total}): ${file.name}...`);
      } else {
        showToast(`正在传输: ${file.name}...`);
      }

      const formData = new FormData();
      formData.append('sender', currentDevice());
      formData.append('device', getDeviceName());
      formData.append('kind', deviceKind());
      formData.append('file', file);

      try {
        const res = await apiFetch('/api/upload', {
          method: 'POST',
          headers: { 'X-LinkFlow-File-Size': String(file.size) },
          body: formData
        });
        const result = await res.json();
        if (result.status === 'ok') {
          successCount++;
          if (total === 1) {
            showToast('传输成功');
          }
        } else {
          showToast(`上传失败 (${file.name}): ${result.error || '未知错误'}`, true);
        }
      } catch (err) {
        console.error('Upload error', err);
        showToast(`传输失败 (${file.name})，请检查网络`, true);
      }
    }

    if (total > 1) {
      if (successCount === total) {
        showToast(`全部传输成功 (共 ${total} 个文件)`);
      } else {
        showToast(`传输完成: 成功 ${successCount}/${total} 个文件`);
      }
    }
    if (successCount > 0) loadInitialData();
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
  // Capture the files during the paste event; clipboard items expire after the handler.
  window.addEventListener('paste', async (e) => {
    if (e.clipboardData && e.clipboardData.items) {
      const items = e.clipboardData.items;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const blob = items[i].getAsFile();
          if (blob) {
            files.push(blob);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        let metadata = null;
        if (isHost) {
          try {
            const response = await apiFetch('/api/system/clipboard?format=files', { signal: AbortSignal.timeout(1500) });
            if (response.ok) metadata = await response.json();
          } catch (_) { /* Preserve browser-provided names if native metadata is unavailable. */ }
        }
        uploadFiles(LinkFlowClipboard.prepare(files, metadata));
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
      showToast('复制失败', true);
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
          showToast(errMsg, true);
        }
      } catch (e) {
        showToast('请求服务失败，请检查服务是否正常运行', true);
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
        showToast('文件未找到或已被移除', true);
      }
    } catch (e) {
      showToast('无法定位文件', true);
    }
  }

  function deleteMessage(msgId, isFile = false) {
    const tip = isFile ? '删除此记录及电脑端保存的文件吗？这会影响所有连接设备，手机已下载的副本不会自动删除。' : '确定删除此消息吗？';
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
      container.innerHTML = `<div style="padding:20px;text-align:center;color:#ff4d4f;font-size:12px;">二维码生成异常，请直接在设备的浏览器中访问:<br><strong style="font-size:14px;color:var(--text-main);">${targetUrl}</strong></div>`;
    }
  }

  async function showQrModal() {
    if (!isHost) {
      if (window.LinkFlowAndroid) { window.location.href = 'linkflow://manage'; return; }
      document.getElementById('connection-server').textContent = '当前电脑：' + (hostName ? hostName + ' · ' : '') + location.host;
      document.getElementById('connection-modal').classList.add('open');
      return;
    }
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
      showToast('无法生成安全配对链接，请重启 LinkFlow 后重试', true);
      return;
    }
    qrModal.classList.add('open');
    renderQrCode(ipSelect && ipSelect.value ? ipSelect.value : lanIp);
  }

  document.getElementById('close-connection-modal').addEventListener('click', () => document.getElementById('connection-modal').classList.remove('open'));
  document.getElementById('reconnect-btn').addEventListener('click', () => {
    document.getElementById('connection-modal').classList.remove('open');
    resumeSync();
  });
  closeQrModal.addEventListener('click', () => qrModal.classList.remove('open'));

  // The copy button is an icon; it turns into a check mark for a moment after copying.
  const QR_COPY_SVG = copyUrlBtn.innerHTML;
  const QR_CHECK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  let copyIconTimer;
  copyUrlBtn.addEventListener('click', () => {
    copyToClipboard(qrUrlText.textContent);
    copyUrlBtn.innerHTML = QR_CHECK_SVG;
    clearTimeout(copyIconTimer);
    copyIconTimer = setTimeout(() => { copyUrlBtn.innerHTML = QR_COPY_SVG; }, 1500);
  });

  // With the Wi-Fi name known the hint says which network to join; otherwise the generic wording stays.
  function updateQrHint() {
    const hint = document.getElementById('qr-hint');
    if (!hint || !wifiName) return;
    const name = document.createElement('strong');
    name.textContent = wifiName;
    hint.replaceChildren('请确保设备也连接至 Wi-Fi 网络：', name, '。');
  }

  // 10. Month Browsing (toolbar)
  function getLocalMonthString(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function updateHistoryBannerCount() {
    if (historyBannerCount) {
      historyBannerCount.textContent = `共 ${monthCounts[currentViewMonth] ?? allMessages.length} 条`;
    }
    if (typeof updateViewTitle === 'function') updateViewTitle();
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
    const viewSeq = cancelTimelineRequests();
    const controller = viewController = new AbortController();
    loadingView = true;
    try {
      const [res] = await Promise.all([
        apiFetch(`/api/messages?month=${encodeURIComponent(monthStr)}&limit=${PAGE_SIZE}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }),
        refreshMonthsList()
      ]);
      const data = await res.json();
      if (seq !== monthSeq || viewSeq !== timelineSeq) return;
      if (data.status === 'ok') {
        currentViewMonth = monthStr;
        allMessages = data.messages || [];
        hasMoreOlder = allMessages.length >= PAGE_SIZE;
        resetSearchText();
        renderMessages(allMessages);
        updateToolbarState();
        renderMonthNav(monthStr);
        updateHistoryBannerCount();
        if (historyBanner) historyBanner.style.display = 'flex';
      } else {
        showToast('获取该月记录失败', true);
        if (currentViewMonth) renderMonthNav(currentViewMonth);
      }
    } catch (err) {
      if (viewSeq !== timelineSeq || err.name === 'AbortError') return;
      console.error('Failed to select month', err);
      showToast('载入失败，请重试', true);
      if (currentViewMonth) renderMonthNav(currentViewMonth);
    } finally {
      if (viewSeq === timelineSeq) { loadingView = false; viewController = null; fillIfShort(); }
    }
  }

  async function exitHistoryMode(force = false) {
    if (currentViewMonth === null && !loadingView && !force) return;
    monthSeq++;
    const seq = cancelTimelineRequests();
    const controller = viewController = new AbortController();
    loadingView = true;
    currentViewMonth = null;
    updateToolbarState();
    if (historyBanner) historyBanner.style.display = 'none';
    try {
      const res = await apiFetch(`/api/messages?limit=${PAGE_SIZE}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const data = await res.json();
      if (seq === timelineSeq && data.status === 'ok') {
        resetSearchText();
        applyLiveMessages(data.messages);
        fillIfShort();
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Failed to exit history mode', err);
    } finally {
      if (seq === timelineSeq) { loadingView = false; viewController = null; fillIfShort(); }
    }
  }

  // Highlights the header toggle buttons while their mode is on
  function updateToolbarState() {
    updateViewTitle();
  }

  // Switching between live view and a month drops the old query (its results are gone)
  function resetSearchText() {
    searchInput.value = '';
    searchSeq++;
    clearTimeout(searchTimer);
    updateViewTitle();
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

  // Clear-all: an in-app confirmation that states what is lost; the destructive button unlocks after 3 s.
  const clearConfirmModal = document.getElementById('clear-confirm-modal');
  const clearConfirmText = document.getElementById('clear-confirm-text');
  const clearConfirmOk = document.getElementById('clear-confirm-ok');
  const clearConfirmCancel = document.getElementById('clear-confirm-cancel');
  let clearCountdown = null;

  function closeClearConfirm() {
    clearInterval(clearCountdown);
    clearConfirmModal.classList.remove('open');
  }

  clearAllBtn.addEventListener('click', () => {
    const mb = storageStats ? (storageStats.total_file_size / (1024 * 1024)).toFixed(1) : '?';
    const count = storageStats ? storageStats.total_messages : '所有';
    clearConfirmText.textContent = `将删除 ${count} 条记录和 ${mb} MB 的已存文件，包括手机发来的图片与文件。此操作无法恢复。`;
    let left = 3;
    clearConfirmOk.disabled = true;
    clearConfirmOk.textContent = `清空 (${left})`;
    clearInterval(clearCountdown);
    clearCountdown = setInterval(() => {
      left -= 1;
      if (left > 0) { clearConfirmOk.textContent = `清空 (${left})`; return; }
      clearInterval(clearCountdown);
      clearConfirmOk.textContent = '清空';
      clearConfirmOk.disabled = false;
    }, 1000);
    clearConfirmModal.classList.add('open');
    clearConfirmCancel.focus();
  });

  clearConfirmCancel.addEventListener('click', closeClearConfirm);
  clearConfirmModal.addEventListener('click', e => { if (e.target === clearConfirmModal) closeClearConfirm(); });

  clearConfirmOk.addEventListener('click', async () => {
    if (clearConfirmOk.disabled) return;
    closeClearConfirm();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear_all' }));
    } else {
      await apiFetch('/api/messages', { method: 'DELETE' });
    }
    settingsModal.classList.remove('open');
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
    cancelTimelineRequests();
    setSearchBarOpen(false);
    searchInput.value = '';
    searchSeq++;
    clearTimeout(searchTimer);
    renderMessages(allMessages);
    updateToolbarState();
  }

  closeSearchBtn.addEventListener('click', closeSearch);

  // PC month bar: the close button leaves month browsing and returns to all records.
  const closeHistoryBtn = document.getElementById('close-history-btn');
  if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', () => exitHistoryMode());

  // Search is opened from the settings list (the header icon is hidden).
  // Menu actions shared by the phone menu rows and the PC settings rows (same behaviour on both).
  function goAllRecords() {
    const pendingView = loadingView;
    if (searchInput.value) closeSearch();
    if (currentViewMonth || pendingView) exitHistoryMode(true);
  }
  function browseByMonth() {
    if (!currentViewMonth) selectMonth(getLocalMonthString(Date.now()));
  }
  function openSearch() {
    setSearchBarOpen(true);
    searchInput.focus();
    updateToolbarState();
  }
  [
    [['menu-all', 'setting-open-all'], goAllRecords],
    [['menu-month', 'setting-open-month'], browseByMonth],
    [['menu-search', 'setting-open-search'], openSearch],
    [['menu-switch'], showQrModal]
  ].forEach(([ids, action]) => ids.forEach((id) => {
    const row = document.getElementById(id);
    if (row) row.addEventListener('click', () => {
      settingsModal.classList.remove('open');
      action();
    });
  }));

  // Connection rows: the connected computer (tap to reconnect and sync) and the pairing / connection entry.
  const menuHostRow = document.getElementById('menu-host-sync');
  const menuSwitch = document.getElementById('menu-switch');
  const menuScan = document.getElementById('menu-scan');
  const menuPair = document.getElementById('menu-pair');
  function refreshMenuHost() {
    const nativeApp = !isHost && !!window.LinkFlowAndroid;
    menuHostRow.hidden = isHost; // the PC window is the computer itself
    document.getElementById('menu-host-name').textContent = hostName || location.hostname;
    document.getElementById('menu-host-sub').textContent = `${statusText.textContent} · ${location.host}`;
    menuSwitch.hidden = nativeApp;
    menuScan.hidden = menuPair.hidden = !nativeApp;
    document.getElementById('menu-switch-label').textContent = isHost ? '显示配对二维码' : (isMobile ? '扫码更换电脑' : '连接管理');
  }
  openSettingsBtn.addEventListener('click', refreshMenuHost);
  menuHostRow.addEventListener('click', () => {
    menuHostRow.classList.add('spinning');
    document.getElementById('menu-host-sub').textContent = '正在同步… · ' + location.host;
    resumeSync();
    setTimeout(() => { menuHostRow.classList.remove('spinning'); refreshMenuHost(); }, 1500);
  });

  // Closes the topmost layer: menu, lightbox, dialog, search, month view. Used by the Android back key and the PC Esc key.
  function closeTopLayer() {
    if (document.querySelector('.compact-menu')) {
      document.querySelectorAll('.compact-menu, .compact-menu-mask').forEach((el) => el.remove());
      return true;
    }
    if (lightboxMask.classList.contains('open')) { lightboxMask.classList.remove('open'); return true; }
    if (document.querySelector('.month-dd.open')) { closeMonthDropdowns(); return true; }
    if (clearConfirmModal.classList.contains('open')) { closeClearConfirm(); return true; }
    for (const id of ['qr-modal', 'connection-modal', 'settings-modal']) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) { el.classList.remove('open'); return true; }
    }
    if (document.activeElement === searchInput) { searchInput.blur(); return true; }
    if (searchBar.classList.contains('active')) { closeSearch(); return true; }
    if (currentViewMonth) { exitHistoryMode(); return true; }
    return false;
  }
  window.LinkFlowBack = closeTopLayer;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || isMobile) return;
    const target = e.target;
    if (target instanceof HTMLElement && target.matches('input, textarea') && target !== searchInput) return;
    if (closeTopLayer()) e.preventDefault();
  });

  // Typing in the search box updates the view title on every platform.
  searchInput.addEventListener('input', updateViewTitle);

  // Search runs on the server so it covers records that are not loaded in the timeline
  searchInput.addEventListener('input', (e) => {
    cancelTimelineRequests();
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
  function showToast(text, isError = false) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.toggle('error', isError);
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

  // 15. Phone layout (review/mobile_design_system.md): view title, always-visible search,
  // full-screen menu, floating send button, collapsing title bar.
  const MONTH_TITLE = (m) => { const [y, mo] = String(m).split('-'); return `${y} 年 ${Number(mo)} 月`; };

  function updateViewTitle() {
    const keyword = searchInput.value.trim();
    const title = keyword ? `搜索：${keyword}` : (currentViewMonth ? '按月份浏览' : '全部记录');
    const viewTitle = document.getElementById('view-title');
    if (viewTitle) {
      viewTitle.textContent = title;
      if (currentViewMonth && !keyword) {
        const count = document.createElement('span');
        count.className = 'view-count';
        count.textContent = ` · 共 ${monthCounts[currentViewMonth] ?? allMessages.length} 条`;
        viewTitle.appendChild(count);
      }
    }
    searchBar.classList.toggle('has-text', !!searchInput.value);
    // Phone menu rows and PC settings rows share the same state.
    ['menu-all', 'setting-open-all'].forEach((id) => {
      const row = document.getElementById(id);
      if (row) row.classList.toggle('selected', !currentViewMonth);
    });
    ['menu-month', 'setting-open-month'].forEach((id) => {
      const row = document.getElementById(id);
      if (row) row.classList.toggle('selected', !!currentViewMonth);
    });
    ['menu-month-label', 'setting-month-label'].forEach((id) => {
      const label = document.getElementById(id);
      if (label) label.textContent = currentViewMonth ? MONTH_TITLE(currentViewMonth) : '';
    });
  }

  if (isMobile) {
    const app = document.getElementById('app-container');
    const ICONS = {
      camera: '<path d="M21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h4l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
      file: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
      refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4"/>',
      scan: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 12h10"/>'
    };
    const icon = (name) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

    openSettingsBtn.title = '菜单';
    openSettingsBtn.setAttribute('aria-label', '菜单');

    // Compact popup menu (<= 240dp) anchored to a button.
    function closeCompactMenu() {
      document.querySelectorAll('.compact-menu, .compact-menu-mask').forEach(el => el.remove());
    }
    function showCompactMenu(anchor, items, upward) {
      closeCompactMenu();
      const mask = document.createElement('div');
      mask.className = 'compact-menu-mask';
      mask.addEventListener('click', closeCompactMenu);
      const menu = document.createElement('div');
      menu.className = 'compact-menu';
      items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = icon(item.icon) + '<span></span>';
        btn.querySelector('span').textContent = item.label;
        btn.addEventListener('click', () => { closeCompactMenu(); item.run(); });
        menu.appendChild(btn);
      });
      document.body.append(mask, menu);
      const r = anchor.getBoundingClientRect();
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      const top = Math.max(8, Math.min(upward ? r.top - h - 8 : r.bottom + 4, window.innerHeight - h - 8));
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }

    window.LinkFlowAttachMenu = () => showCompactMenu(sendBtn, [
      { icon: 'camera', label: '拍照', run: () => cameraInput.click() },
      { icon: 'image', label: '图片 / 视频', run: () => mediaInput.click() },
      { icon: 'file', label: '任意文件', run: () => fileInput.click() }
    ], true);
    window.LinkFlowSendMode = () => chatInputBox.classList.toggle('has-text', !!messageInput.value.trim());
    messageInput.addEventListener('input', window.LinkFlowSendMode);

    // Menu: views and the connected computer.
    const closeMenu = () => settingsModal.classList.remove('open');
    openSettingsBtn.addEventListener('click', () => { app.classList.remove('compact'); });
    menuScan.addEventListener('click', () => { closeMenu(); window.location.href = 'linkflow://scan'; });
    menuPair.addEventListener('click', () => { closeMenu(); window.location.href = 'linkflow://pair'; });

    // Title bar and search collapse while reading down the list, expand when scrolling back up.
    let touching = false;
    let touchTimer = 0;
    let lastTop = chatHistory.scrollTop;
    let lockUntil = 0;
    chatHistory.addEventListener('touchstart', () => { touching = true; clearTimeout(touchTimer); }, { passive: true });
    ['touchend', 'touchcancel'].forEach(name => chatHistory.addEventListener(name, () => {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => { touching = false; }, 700);
    }, { passive: true }));
    chatHistory.addEventListener('scroll', () => {
      const top = chatHistory.scrollTop;
      const delta = top - lastTop;
      lastTop = top;
      if (!touching || Date.now() < lockUntil || Math.abs(delta) < 6) return;
      const hold = document.activeElement === searchInput || !!searchInput.value;
      const collapse = delta > 0 && top > 24 && !hold;
      if (collapse !== app.classList.contains('compact')) {
        app.classList.toggle('compact', collapse);
        lockUntil = Date.now() + 300;
        lastTop = chatHistory.scrollTop;
      }
    }, { passive: true });
    searchInput.addEventListener('focus', () => app.classList.remove('compact'));

  }

  // Initialize
  updateViewTitle();
  initSingleInstance();
  connectWebSocket();
  window.LinkFlowUiReady = true;
})();
