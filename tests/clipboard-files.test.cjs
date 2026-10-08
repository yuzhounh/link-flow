const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../static/js/clipboard-files.js');
const date = new Date('2026-10-07T12:00:00Z');

test('named APK, PDF and image files retain name, object and bytes', async () => {
  for (const [name, type] of [['PageTrace.apk', 'application/vnd.android.package-archive'], ['paper.pdf', 'application/pdf'], ['image.png', 'image/png']]) {
    const original = new File(['original bytes'], name, { type });
    const [result] = prepare([original], { names: [name], hasImage: true }, date);
    assert.equal(result, original);
    assert.equal(await result.text(), 'original bytes');
  }
});
test('raw image pixels receive neutral names and encoding-specific extensions', async () => {
  for (const [type, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/svg+xml', 'svg']]) {
    const original = new File(['pixels'], 'image.png', { type });
    const [result] = prepare([original], { names: [], hasImage: true }, date);
    assert.equal(result.name, `Image_2026-10-07T12-00-00-000Z_1.${extension}`);
    assert.equal(result.type, type);
    assert.equal(await result.text(), 'pixels');
  }
});
test('real file wins over its additional image representation', () => {
  const file = new File(['original'], 'photo.jpg', { type: 'image/jpeg' });
  const pixels = new File(['preview'], 'image.png', { type: 'image/png' });
  assert.deepEqual(prepare([file, pixels], { names: ['photo.jpg'], hasImage: true }), [file]);
});
test('distinct files are not collapsed by matching type or size', () => {
  const files = ['one.png', 'two.png'].map(name => new File(['same'], name, { type: 'image/png' }));
  assert.deepEqual(prepare(files, { names: files.map(f => f.name), hasImage: true }), files);
});
test('missing metadata preserves names; unnamed APK uses apk rather than MIME suffix', () => {
  const named = new File(['x'], 'image.png', { type: 'image/png' });
  assert.equal(prepare([named], null)[0], named);
  const unnamed = new File(['x'], '', { type: 'application/vnd.android.package-archive' });
  assert.match(prepare([unnamed], null)[0].name, /^File_.*\.apk$/);
});
test('unnamed images are named without metadata, with unique names within a paste', () => {
  const files = [new File(['a'], '', { type: 'image/png' }), new File(['b'], '', { type: 'image/png' })];
  const result = prepare(files, null, date);
  assert.match(result[0].name, /^Image_.*_1\.png$/);
  assert.match(result[1].name, /^Image_.*_2\.png$/);
});
