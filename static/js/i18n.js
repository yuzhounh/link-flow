// Shell-only bilingual (Simplified Chinese / English) runtime for LinkFlow.
// Provides 1-click toggle in header and settings dialog with L key shortcut.

(function () {
  const STORAGE_KEY = 'linkflow_lang';
  const SUPPORTED = ['zh', 'en'];

  const EN = {
    '文件传输助手': 'LinkFlow - File Transfer',
    '全部记录': 'All Records',
    '正在连接…': 'Connecting…',
    '正在连接电脑…': 'Connecting to PC…',
    '已连接设备': 'Device connected',
    '已连接电脑': 'PC connected',
    '连接已断开': 'Disconnected',
    '重试连接中…': 'Reconnecting…',
    '设置': 'Settings',
    '选择年份': 'Select Year',
    '选择月份': 'Select Month',
    '上一个有记录的月份': 'Previous Month',
    '下一个有记录的月份': 'Next Month',
    '跳到本月': 'Jump to Current Month',
    '本月': 'This Month',
    '共 0 条': '0 records',
    '关闭按月份浏览': 'Close monthly view',
    '搜索文字内容或文件名': 'Search text or filename',
    '清除搜索': 'Clear search',
    '输入文字，或直接拖入 / 粘贴文件...': 'Type a message, drag & drop, or paste files...',
    '拍照直接上传': 'Take photo & upload',
    '图片/视频': 'Photos & Videos',
    '发送任意文件': 'Send files',
    '发送 (Enter)': 'Send (Enter)',
    '发送': 'Send',
    '释放文件立即传输': 'Drop files here to send immediately',
    '支持图片、视频、PDF、ZIP 等任意文件': 'Supports images, videos, PDFs, ZIPs and more',
    '扫码直连': 'Scan QR Code',
    '请确保设备与这台电脑连接在同一个 Wi-Fi 网络下': 'Make sure this device and PC are connected to the same Wi-Fi network',
    '连接管理': 'Connection Management',
    '重新连接并同步消息': 'Reconnect & Sync Messages',
    '记录与设置': 'Records & Settings',
    '按月份浏览': 'Browse by Month',
    '搜索记录': 'Search Records',
    '设备名称': 'Device Name',
    '电脑': 'PC',
    '扫码更换电脑': 'Scan to switch PC',
    '摄像头扫码连接': 'Scan QR code with camera',
    '粘贴配对链接': 'Paste pairing link',
    '深色模式': 'Dark Mode',
    '界面语言': 'Language',
    '使用说明': 'Help & Guide',
    '清空记录与文件': 'Clear records & files',
    '清空': 'Clear',
    '取消': 'Cancel',
    '清空所有记录与文件？': 'Clear all records and files?',
    '已复制到剪贴板': 'Copied to clipboard',
    '复制链接': 'Copy Link',
    '关闭': 'Close',
    '关闭连接管理': 'Close Connection Management'
  };

  const ATTR = {
    '设置': 'Settings',
    '选择年份': 'Select Year',
    '选择月份': 'Select Month',
    '上一个有记录的月份': 'Previous Month',
    '下一个有记录的月份': 'Next Month',
    '跳到本月': 'Jump to Current Month',
    '关闭按月份浏览': 'Close monthly view',
    '搜索文字内容或文件名': 'Search text or filename',
    '清除搜索': 'Clear search',
    '输入文字，或直接拖入 / 粘贴文件...': 'Type a message, drag & drop, or paste files...',
    '拍照直接上传': 'Take photo & upload',
    '图片/视频': 'Photos & Videos',
    '发送任意文件': 'Send files',
    '发送 (Enter)': 'Send (Enter)',
    '发送': 'Send',
    '关闭': 'Close',
    '复制链接': 'Copy Link',
    '关闭连接管理': 'Close connection management',
    '设备名称': 'Device name',
    '返回设置': 'Back to settings',
    '切换语言 (L)': 'Switch language (L)',
    '重新连接并同步': 'Reconnect and sync'
  };

  const DOC = {
    title: { zh: '文件传输助手', en: 'LinkFlow - File Transfer' }
  };

  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();
  const listeners = new Set();

  function normalize(lang) {
    return SUPPORTED.includes(lang) ? lang : 'zh';
  }

  function getLang() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY) || 'zh');
    } catch {
      return 'zh';
    }
  }

  function isEn() {
    return getLang() === 'en';
  }

  function pad(original, replacement) {
    const lead = (original.match(/^\s*/) || [''])[0];
    const trail = (original.match(/\s*$/) || [''])[0];
    return lead + replacement + trail;
  }

  function applyTextNode(node, en) {
    if (originalText.has(node)) {
      const original = originalText.get(node);
      if (en) {
        const key = original.trim();
        node.nodeValue = Object.prototype.hasOwnProperty.call(EN, key)
          ? pad(original, EN[key])
          : original;
      } else {
        node.nodeValue = original;
        originalText.delete(node);
      }
      return;
    }
    if (!en) return;
    const current = node.nodeValue;
    const key = current.trim();
    if (!key || !Object.prototype.hasOwnProperty.call(EN, key)) return;
    originalText.set(node, current);
    node.nodeValue = pad(current, EN[key]);
  }

  function applyAttr(el, attr, en) {
    if (!el.hasAttribute(attr)) return;
    let map = originalAttrs.get(el);
    if (!map) {
      map = new Map();
      originalAttrs.set(el, map);
    }
    if (!map.has(attr)) map.set(attr, el.getAttribute(attr));
    const original = map.get(attr);
    const key = (original || '').trim();
    if (en && Object.prototype.hasOwnProperty.call(ATTR, key)) {
      el.setAttribute(attr, ATTR[key]);
    } else {
      el.setAttribute(attr, original);
    }
  }

  function syncUI() {
    const en = isEn();
    const label = en ? '中' : 'EN';
    const title = en ? '切换为简体中文 (L)' : 'Switch to English (L)';
    const headerBtn = document.getElementById('header-lang-btn');
    if (headerBtn) {
      headerBtn.title = title;
      headerBtn.setAttribute('aria-label', title);
      const span = headerBtn.querySelector('.lang-toggle-text');
      if (span) span.textContent = label;
      else headerBtn.textContent = label;
    }
    const valEl = document.getElementById('setting-lang-value');
    if (valEl) {
      valEl.textContent = en ? 'English' : '简体中文';
    }
  }

  function applyStatic() {
    const en = isEn();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentNode && node.parentNode.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) applyTextNode(node, en);

    document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach((el) => {
      ['placeholder', 'title', 'aria-label', 'alt'].forEach((attr) => applyAttr(el, attr, en));
    });

    document.documentElement.lang = en ? 'en' : 'zh-CN';
    document.title = DOC.title[en ? 'en' : 'zh'];

    syncUI();
  }

  function setLang(lang) {
    const next = normalize(lang);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    applyStatic();
    listeners.forEach((cb) => {
      try { cb(next); } catch {}
    });
    return next;
  }

  function toggleLang() {
    return setLang(isEn() ? 'zh' : 'en');
  }

  function t(key) {
    if (!isEn()) return key;
    return EN[key] || key;
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function init() {
    applyStatic();
    const headerBtn = document.getElementById('header-lang-btn');
    if (headerBtn) headerBtn.addEventListener('click', toggleLang);
    const settingRow = document.getElementById('setting-lang-row');
    if (settingRow) settingRow.addEventListener('click', toggleLang);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
          return;
        }
        toggleLang();
      }
    });
  }

  
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY && SUPPORTED.includes(e.newValue)) {
        setLang(e.newValue);
      }
    });

  window.LinkFlowI18N = {
    getLang,
    setLang,
    toggleLang,
    isEn,
    t,
    applyStatic,
    onChange
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
