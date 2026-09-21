import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

test('Codex mask has transparent background and visible antialiased logo pixels', async () => {
  const { data, info } = await sharp('src/renderer/assets/agents/codex-transparent.png')
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0);
  let opaque = 0;
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i] + data[i + 1] + data[i + 2], 0);
    if (data[i + 3] > 200) opaque++;
    if (data[i + 3] === 0) transparent++;
  }
  assert.ok(opaque > info.width * info.height * 0.15);
  assert.ok(transparent > info.width * info.height * 0.3);
});
