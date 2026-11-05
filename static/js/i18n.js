// Shell-only bilingual (Simplified Chinese / English) runtime for LinkFlow.
// Provides 1-click toggle in settings dialog with L key shortcut and storage sync.

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
    '扫码更换电脑': 'Scan to Switch PC',
    '配对二维码': 'Pairing QR Code',
    '摄像头扫码连接': 'Scan QR code with camera',
    '粘贴配对链接': 'Paste pairing link',
    '深色模式': 'Dark Mode',
    '外观主题': 'Theme',
    '主题模式': 'Theme',
    '深色': 'Dark',
    '浅色': 'Light',
    '界面语言': 'Language',
    '使用说明': 'Help & Guide',
    '清空记录与文件': 'Clear records & files',
    '正在统计存储状态...': 'Calculating storage stats...',
    '清空': 'Clear',
    '取消': 'Cancel',
    '清空所有记录与文件？': 'Clear all records and files?',
    '已复制到剪贴板': 'Copied to clipboard',
    '复制链接': 'Copy Link',
    '关闭': 'Close',
    '关闭连接管理': 'Close Connection Management',
    '菜单': 'Menu',
    '文件传输助手已在运行': 'LinkFlow is already running',
    '检测到当前浏览器中已有正在运行的文件传输助手。': 'LinkFlow is already open in this browser.',
    '为避免重复占用内存及多标签堆积，请直接切换回已打开的标签页。': 'Switch back to the existing tab to avoid running a second copy.',
    '关闭当前标签页': 'Close this tab',
    '仍在此标签页使用': 'Use this tab anyway',
    '若浏览器限制关闭，请直接点击顶部标签栏 ✕ 关闭': 'If the browser blocks closing this tab, use the tab’s close button.',
    '已切换至当前标签页为主界面': 'This tab is now the main LinkFlow tab.',
    '可选 IP: ': 'Select IP: ',
    '可选 IP:': 'Select IP:',
    '请保持本设备与电脑在可互通的网络中。更换电脑时，用手机相机扫描新电脑 LinkFlow 中的配对二维码，再打开链接。': 'Keep this device and PC on a reachable network. When switching PCs, scan the pairing QR code in LinkFlow on the new PC with your phone camera and open the link.'
  };

  const ATTR = {
    '菜单': 'Menu',
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
    '配对二维码': 'Pairing QR Code',
    '重新连接并同步': 'Reconnect and sync'
  };

  // Bidirectional reverse dictionaries
  const ZH = {};
  for (const [zh, en] of Object.entries(EN)) {
    ZH[en] = zh;
  }
  const ATTR_ZH = {};
  for (const [zh, en] of Object.entries(ATTR)) {
    ATTR_ZH[en] = zh;
  }

  const DOC = {
    title: { zh: '文件传输助手', en: 'LinkFlow - File Transfer' }
  };

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
    const current = node.nodeValue;
    const key = (current || '').trim();
    if (!key) return;

    if (en) {
      if (Object.prototype.hasOwnProperty.call(EN, key)) {
        node.nodeValue = pad(current, EN[key]);
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(ZH, key)) {
        node.nodeValue = pad(current, ZH[key]);
      }
    }
  }

  function applyAttr(el, attr, en) {
    if (!el.hasAttribute(attr)) return;
    const current = el.getAttribute(attr);
    const key = (current || '').trim();
    if (!key) return;

    if (en) {
      if (Object.prototype.hasOwnProperty.call(ATTR, key)) {
        el.setAttribute(attr, ATTR[key]);
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(ATTR_ZH, key)) {
        el.setAttribute(attr, ATTR_ZH[key]);
      }
    }
  }

  function syncUI() {
    const en = isEn();
    const valEl = document.getElementById('setting-lang-value');
    if (valEl) {
      valEl.textContent = en ? 'English' : '简体中文';
    }
    const themeValEl = document.getElementById('setting-theme-value');
    if (themeValEl) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (en) {
        themeValEl.textContent = isDark ? 'Dark' : 'Light';
      } else {
        themeValEl.textContent = isDark ? '深色' : '浅色';
      }
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
      try { cb(next); } catch (e) { console.error('LinkFlow i18n listener error', e); }
    });
    return next;
  }

  function toggleLang() {
    return setLang(isEn() ? 'zh' : 'en');
  }

  function t(key, targetLang) {
    const lang = targetLang || getLang();
    if (lang === 'en') {
      return EN[key] || key;
    } else {
      return ZH[key] || key;
    }
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function init() {
    applyStatic();
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
