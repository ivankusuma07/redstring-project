/**
 * Rasterise src/app/icon.svg (the crow) into the formats browsers and phones still ask for:
 *   src/app/favicon.ico   16/32/48 px (PNG-in-ICO)
 *   src/app/apple-icon.png 180 px
 * Run after editing the SVG: npm run build:icons
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("src/app/icon.svg");
const png = (size) => sharp(svg, { density: 72 * (size / 64) * 4 }).resize(size, size).png().toBuffer();

// ICO container holding PNG images (supported by every current browser)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(sizes[i] % 256, e); // width (0 = 256)
  header.writeUInt8(sizes[i] % 256, e + 1); // height
  header.writeUInt8(0, e + 2); // palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));

await writeFile("src/app/apple-icon.png", await sharp(svg, { density: 72 * 12 }).resize(180, 180).png().toBuffer());
console.log("wrote favicon.ico (16/32/48) and apple-icon.png (180)");
