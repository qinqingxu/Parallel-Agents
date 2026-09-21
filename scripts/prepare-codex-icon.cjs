const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const folder = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'agents');
  const { data, info } = await sharp(path.join(folder, 'codex.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    data[i + 3] = Math.round((data[i + 3] * (255 - luminance)) / 255);
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(folder, 'codex-transparent.png'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
