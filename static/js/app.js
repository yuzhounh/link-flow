// LinkFlow Client Application
(function() {
  // 1. Device detection
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const currentDevice = isMobile ? 'phone' : 'pc';

  const deviceTag = document.getElementById('device-tag');
  if (deviceTag) {
    deviceTag.textContent = isMobile ? '📱 手机端' : '💻 电脑端';
  }
  if (isMobile) {
    document.body.classList.add('is-mobile');
  } else {
    document.body.classList.add('is-desktop');
  }

  // 2. State variables
  let ws = null;
  let lanIp = location.hostname;
  let allIps = [];
  let port = location.port || (location.protocol === 'https:' ? '443' : '80');
  let autoClipboard = true;
  let qrcodeObj = null;
  let allMessages = [];

  // DOM elements
  const chatHistory = document.getElementById('chat-history');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const dropZone = document.getElementById('drop-zone');
  const toast = document.getElementById('toast');
  const clipboardBadge = document.getElementById('clipboard-badge');

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
  const clearAllBtn = document.getElementById('clear-all-btn');
  const storageStatsText = document.getElementById('storage-stats-text');

  const lightboxMask = document.getElementById('lightbox-mask');
  const lightboxImg = document.getElementById('lightbox-img');

  const toggleSearchBtn = document.getElementById('toggle-search-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const closeSearchBtn = document.getElementById('close-search-btn');

  const fileInput = document.getElementById('file-input');
  const mediaInput = document.getElementById('media-input');
  const cameraInput = document.getElementById('camera-input');

  // Theme initialization
  const savedTheme = localStorage.getItem('linkflow_theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    settingDarkTheme.checked = true;
  }

  settingDarkTheme.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('linkflow_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('linkflow_theme', 'light');
    }
  });

  // 3. WebSocket Connection
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

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
      statusText.textContent = '连接断开，重试中...';
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
      updateClipboardBadge();
    } else if (data.type === 'new_message') {
      const msg = data.message;
      allMessages.push(msg);
      appendMessageToUI(msg, true);
    } else if (data.type === 'message_deleted') {
      const row = document.getElementById(`msg-${data.id}`);
      if (row) row.remove();
      allMessages = allMessages.filter(m => m.id !== data.id);
    } else if (data.type === 'messages_cleared') {
      chatHistory.innerHTML = '';
      allMessages = [];
      showToast('聊天记录已清空');
    }
  }

  // 4. REST API & Initial Load
  async function loadInitialData() {
    try {
      const [msgRes, infoRes] = await Promise.all([
        fetch('/api/messages?limit=100'),
        fetch('/api/system/info')
      ]);

      const msgData = await msgRes.json();
      if (msgData.status === 'ok') {
        allMessages = msgData.messages;
        renderMessages(allMessages);
      }

      const infoData = await infoRes.json();
      if (infoData.status === 'ok') {
        lanIp = infoData.lan_ip;
        allIps = infoData.all_ips || [lanIp];
        port = infoData.port;
        autoClipboard = infoData.auto_clipboard;
        settingAutoClipboard.checked = autoClipboard;
        updateClipboardBadge();
        updateStorageStats(infoData.stats);
        setupIpSelector();
      }
    } catch (e) {
      console.error('Failed to load initial data', e);
    }
  }

  function updateClipboardBadge() {
    if (clipboardBadge) {
      clipboardBadge.style.display = autoClipboard ? 'flex' : 'none';
    }
  }

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

  function renderMessages(messages) {
    chatHistory.innerHTML = '';
    let lastDate = '';

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

    scrollToBottom();
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function appendMessageToUI(msg, autoScroll = true) {
    const isSelf = (msg.sender === currentDevice);
    const row = document.createElement('div');
    row.id = `msg-${msg.id}`;
    row.className = `message-row sender-${msg.sender} ${isSelf ? 'is-current-device' : 'is-peer-device'}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'sender-avatar';
    avatar.textContent = (msg.sender === 'phone') ? '📱' : '💻';

    // Body container
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'message-body-wrap';

    // Meta header (sender & time)
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${msg.sender === 'phone' ? '手机' : '电脑'} · ${formatTime(msg.timestamp)}`;
    bodyWrap.appendChild(meta);

    // Content Bubble based on msg_type
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    // Actions mini menu
    const actions = document.createElement('div');
    actions.className = 'bubble-actions';

    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn-mini';
    delBtn.innerHTML = '🗑️ 删除';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMessage(msg.id);
    };
    actions.appendChild(delBtn);

    if (msg.msg_type === 'text') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'action-btn-mini';
      copyBtn.innerHTML = '📋 复制';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(msg.content);
      };
      actions.appendChild(copyBtn);

      const textSpan = document.createElement('span');
      textSpan.innerHTML = escapeAndLinkText(msg.content);
      bubble.appendChild(textSpan);
    } else if (msg.msg_type === 'video') {
      bubble.className = 'video-card';
      const video = document.createElement('video');
      video.src = `/files/${msg.file_path}`;
      video.controls = true;
      video.preload = 'metadata';
      bubble.appendChild(video);
    } else if (msg.msg_type === 'audio') {
      bubble.className = 'audio-card';
      const audio = document.createElement('audio');
      audio.src = `/files/${msg.file_path}`;
      audio.controls = true;
      bubble.appendChild(audio);
    } else if (msg.msg_type === 'pdf') {
      bubble.className = 'pdf-card';
      if (msg.thumb_path) {
        const cover = document.createElement('div');
        cover.className = 'pdf-preview-cover';
        const coverImg = document.createElement('img');
        coverImg.src = `/thumbs/${msg.thumb_path}`;
        coverImg.onclick = () => window.open(`/files/${msg.file_path}`, '_blank');
        cover.appendChild(coverImg);
        bubble.appendChild(cover);
      }

      const infoRow = document.createElement('div');
      infoRow.className = 'pdf-info-row';
      infoRow.innerHTML = `
        <div class="file-info">
          <a class="file-name" href="/files/${msg.file_path}" target="_blank" title="${msg.file_name}">${msg.file_name}</a>
          <div class="file-meta">📄 PDF · ${formatFileSize(msg.file_size)}</div>
        </div>
        <div class="file-ops">
          <a class="file-op-btn" href="/files/${msg.file_path}" download="${msg.file_name}" title="下载">⬇️</a>
          ${!isMobile ? `<button class="file-op-btn open-folder-btn" title="在文件夹中定位">📁</button>` : ''}
        </div>
      `;
      bubble.appendChild(infoRow);

      if (!isMobile) {
        const btn = infoRow.querySelector('.open-folder-btn');
        if (btn) btn.onclick = () => revealInFolder(msg.id);
      }
    } else {
      // File Card (Images and any general files)
      bubble.className = 'file-card';
      const ext = (msg.file_name.split('.').pop() || 'FILE').toUpperCase();
      const isImg = ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'BMP', 'SVG', 'HEIC', 'ICO', 'AVIF'].includes(ext);
      const icon = isImg ? '🖼️' : '📦';
      bubble.innerHTML = `
        <div class="file-icon-box">${icon}</div>
        <div class="file-info">
          <a class="file-name" href="/files/${msg.file_path}" target="_blank" title="${msg.file_name}">${msg.file_name}</a>
          <div class="file-meta">${ext} · ${formatFileSize(msg.file_size)}</div>
        </div>
        <div class="file-ops">
          <a class="file-op-btn" href="/files/${msg.file_path}" download="${msg.file_name}" title="下载">⬇️</a>
          ${!isMobile ? `<button class="file-op-btn open-folder-btn" title="在文件夹中定位">📁</button>` : ''}
        </div>
      `;
      if (!isMobile) {
        const btn = bubble.querySelector('.open-folder-btn');
        if (btn) btn.onclick = () => revealInFolder(msg.id);
      }
    }

    bubble.appendChild(actions);
    bodyWrap.appendChild(bubble);

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
    messageInput.placeholder = isMobile ? '输入消息...' : '输入文字，支持拖拽文件或直接 Ctrl+V 粘贴截图...';
  }

  // 6. Sending Messages & Uploads
  function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'text',
        sender: currentDevice,
        content: text,
        timestamp: Date.now()
      }));
      messageInput.value = '';
      messageInput.style.height = isMobile ? '38px' : '40px';
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

  // Auto-grow textarea smoothly
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    const baseH = isMobile ? 38 : 40;
    const maxH = 120;
    const scrollH = messageInput.scrollHeight;
    const targetH = Math.min(Math.max(scrollH, baseH), maxH);
    messageInput.style.height = targetH + 'px';
    messageInput.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  });

  async function uploadFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      showToast(`正在传输: ${file.name}...`);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('sender', currentDevice);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
        if (result.status === 'ok') {
          showToast('传输成功');
        } else {
          showToast(`上传失败: ${result.error || '未知错误'}`);
        }
      } catch (err) {
        console.error('Upload error', err);
        showToast('传输失败，请检查网络');
      }
    }
  }

  // File pickers
  fileInput.addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    fileInput.value = '';
  });

  mediaInput.addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    mediaInput.value = '';
  });

  cameraInput.addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    cameraInput.value = '';
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

  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function revealInFolder(msgId) {
    try {
      const res = await fetch('/api/system/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgId })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        showToast('已在资源管理器中定位');
      } else {
        showToast('文件未找到或已被移除');
      }
    } catch (e) {
      showToast('无法定位文件');
    }
  }

  function deleteMessage(msgId) {
    if (confirm('确定删除此消息吗？')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'delete', id: msgId }));
      } else {
        fetch(`/api/messages?id=${msgId}`, { method: 'DELETE' });
      }
    }
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
    const targetUrl = `http://${ip}:${port}`;
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

  function showQrModal() {
    qrModal.classList.add('open');
    renderQrCode(ipSelect && ipSelect.value ? ipSelect.value : lanIp);
  }

  openQrBtn.addEventListener('click', showQrModal);
  closeQrModal.addEventListener('click', () => qrModal.classList.remove('open'));
  doneQrBtn.addEventListener('click', () => qrModal.classList.remove('open'));

  copyUrlBtn.addEventListener('click', () => {
    copyToClipboard(qrUrlText.textContent);
  });

  // 10. Settings Modal
  openSettingsBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/system/info');
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
    updateClipboardBadge();
    try {
      await fetch('/api/system/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_clipboard: autoClipboard })
      });
      showToast(autoClipboard ? '已开启剪贴板自动同步' : '已关闭剪贴板自动同步');
    } catch (err) {
      console.error(err);
    }
  });

  clearAllBtn.addEventListener('click', async () => {
    if (confirm('确定清空所有历史记录和文件吗？此操作无法撤销。')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear_all' }));
      } else {
        await fetch('/api/messages', { method: 'DELETE' });
      }
      settingsModal.classList.remove('open');
    }
  });

  // 11. Lightbox Image
  function openLightbox(src) {
    lightboxImg.src = src;
    lightboxMask.classList.add('open');
  }

  lightboxMask.addEventListener('click', () => {
    lightboxMask.classList.remove('open');
  });

  // 12. Search Filtering
  toggleSearchBtn.addEventListener('click', () => {
    searchBar.classList.toggle('active');
    if (searchBar.classList.contains('active')) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      renderMessages(allMessages);
    }
  });

  closeSearchBtn.addEventListener('click', () => {
    searchBar.classList.remove('active');
    searchInput.value = '';
    renderMessages(allMessages);
  });

  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.trim().toLowerCase();
    if (!keyword) {
      renderMessages(allMessages);
      return;
    }
    const filtered = allMessages.filter(msg => {
      const c = (msg.content || '').toLowerCase();
      const fn = (msg.file_name || '').toLowerCase();
      return c.includes(keyword) || fn.includes(keyword);
    });
    renderMessages(filtered);
  });

  // 13. Toast helper
  let toastTimer = null;
  function showToast(text) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // Initialize
  loadInitialData();
  connectWebSocket();
})();
