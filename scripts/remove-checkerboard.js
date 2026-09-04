const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error('Uso: node scripts/remove-checkerboard.js <entrada.png> <salida.png>');
  }

  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixelCount = width * height;
  const transparent = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  function isCheckerboard(index) {
    const offset = index * channels;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return min >= 218 && max - min <= 18;
  }

  function enqueue(index) {
    if (transparent[index] || !isCheckerboard(index)) return;
    transparent[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const output = Buffer.allocUnsafe(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const sourceOffset = index * channels;
    const outputOffset = index * 4;
    output[outputOffset] = data[sourceOffset];
    output[outputOffset + 1] = data[sourceOffset + 1];
    output[outputOffset + 2] = data[sourceOffset + 2];
    output[outputOffset + 3] = transparent[index] ? 0 : 255;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(output, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
