import { PNG } from 'pngjs';

/** 4×4 area-averaged RGB, one integer byte per channel (48 bounded means).
 * This measures rendered color/light rather than PNG compression or private object IDs. */
export const IMAGE_SIGNATURE_SIDE = 4;
export function imageSignature(bytes: Uint8Array): number[] {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 33 || buffer.length > 8 * 1024 * 1024 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid bounded PNG image');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 1024 || height > 1024) throw new Error('PNG dimensions exceed sensor bounds');
  const png = PNG.sync.read(buffer, { checkCRC: true });
  const result = new Array<number>(IMAGE_SIGNATURE_SIDE * IMAGE_SIGNATURE_SIDE * 3);
  for (let y = 0; y < IMAGE_SIGNATURE_SIDE; y++) for (let x = 0; x < IMAGE_SIGNATURE_SIDE; x++) {
    const x0 = Math.floor(x * width / IMAGE_SIGNATURE_SIDE), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / IMAGE_SIGNATURE_SIDE));
    const y0 = Math.floor(y * height / IMAGE_SIGNATURE_SIDE), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / IMAGE_SIGNATURE_SIDE));
    const sum = [0, 0, 0]; let count = 0;
    for (let py = y0; py < Math.min(height, y1); py++) for (let px = x0; px < Math.min(width, x1); px++) {
      const i = (py * width + px) * 4, alpha = png.data[i + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += png.data[i + c] * alpha;
      count++;
    }
    for (let c = 0; c < 3; c++) result[(y * IMAGE_SIGNATURE_SIDE + x) * 3 + c] = Math.round(sum[c] / count);
  }
  return result;
}
