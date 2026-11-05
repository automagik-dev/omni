/**
 * A QR code as an SVG string, drawn with the encoder qrcode-terminal already ships
 * (vendor/QRCode), so pages can show WhatsApp's linking code without a library of
 * their own. One path of dark modules on white, with a quiet zone.
 */

import { createRequire } from 'node:module';

// qrcode-terminal ships its encoder as CommonJS only, with no types.
const load = createRequire(import.meta.url);
const QRCode = load('qrcode-terminal/vendor/QRCode') as new (
  typeNumber: number,
  errorCorrectLevel: number,
) => { addData(data: string): void; make(): void; getModuleCount(): number; isDark(row: number, col: number): boolean };
const QRErrorCorrectLevel = load('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as { L: number };

export function qrSvg(text: string, size = 256): string {
  const code = new QRCode(-1, QRErrorCorrectLevel.L);
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  let d = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  }
  const box = count + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-4 -4 ${box} ${box}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${box}" height="${box}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
