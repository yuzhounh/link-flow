const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/download-progress.js'), 'utf8');

// Stored items are own enumerable properties, as in a browser, so Object.keys(localStorage) lists them.
class FakeStorage {
  getItem(name) { return Object.hasOwn(this, name) ? this[name] : null; }
  setItem(name, value) { this[name] = String(value); }
  removeItem(name) { delete this[name]; }
}
function load(storage) {
  const listeners = {};
  const window = { LinkFlowIcons: { svg: () => '' } };
  const context = vm.createContext({
    window, localStorage: storage, location: { href: 'http://host/' }, URL,
    document: { addEventListener: (type, listener) => { listeners[type] = listener; }, querySelectorAll: () => [] },
  });
  vm.runInContext(source, context);
  const acknowledge = (url, downloadId) => {
    window.LinkFlowDownloadProgress({ status: 'complete', url, downloadId });
    const card = { dataset: { fileUrl: url }, querySelector: () => null, classList: { add() {} } };
    listeners.click({ target: { closest: () => card } });
  };
  return { acknowledge, seen: () => JSON.parse(storage.getItem('linkflow-received-seen') || '{}') };
}

test('per-file seen keys from earlier versions move into one map', () => {
  const storage = new FakeStorage();
  storage.setItem('linkflow-received-seen:http://host/files/a.pdf', '7');
  storage.setItem('linkflow_theme', 'dark');
  const page = load(storage);
  assert.deepEqual(page.seen(), { 'http://host/files/a.pdf': '7' });
  assert.deepEqual(Object.keys(storage).sort(), ['linkflow-received-seen', 'linkflow_theme']);
  page.acknowledge('http://host/files/b.zip', 9);
  assert.deepEqual(page.seen(), { 'http://host/files/a.pdf': '7', 'http://host/files/b.zip': '9' });
});

test('the seen map keeps the newest 1000 files', () => {
  const storage = new FakeStorage();
  const map = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`http://host/files/${i}`, String(i)]));
  storage.setItem('linkflow-received-seen', JSON.stringify(map));
  const page = load(storage);
  page.acknowledge('http://host/files/new', 5000);
  const seen = page.seen();
  assert.equal(Object.keys(seen).length, 1000);
  assert.equal(seen['http://host/files/0'], undefined);
  assert.equal(seen['http://host/files/new'], '5000');
});
