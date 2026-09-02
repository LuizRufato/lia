const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const patch = fs.readFileSync(
  path.join(__dirname, 'patches', '2.3.7-preview-required.patch'),
  'utf8',
);

test('Evolution preview fetch sends a WhatsApp crawler user agent', () => {
  assert.match(patch, /getUrlInfo\(parsedUrl\.toString\(\), \{/);
  assert.match(
    patch,
    /fetchOpts:\s*\{[\s\S]*?'User-Agent':\s*'WhatsApp\/2\.0 LIA-Preview\/1\.0'/,
  );
});

test('Evolution preview request keeps the required safety contract', () => {
  assert.match(patch, /REQUIRED_PREVIEW_TIMEOUT_MS = 5_000/);
  assert.match(patch, /REQUIRED_PREVIEW_MAX_BYTES = 2_000_000/);
  assert.match(patch, /parsedUrl\.protocol !== 'https:'/);
  assert.match(patch, /parsedUrl\.hostname !== REQUIRED_PREVIEW_HOST/);
  assert.match(patch, /isPrivatePreviewAddress/);
  assert.match(patch, /Buffer\.isBuffer\(preview\.jpegThumbnail\)/);
});
