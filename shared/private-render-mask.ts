/** Internal renderer/qualification transport. Never include this in public sensor views. */
export const PRIVATE_MASK_REVISION = 'physical-id-mask-v1' as const;
export interface PrivateRenderMask {
  bytes: Uint8Array;
  /** RGB is a little-endian 24-bit index. Zero is background or an unlabelled occluder. */
  physicalIds: string[];
  revision: typeof PRIVATE_MASK_REVISION;
  width: number;
  height: number;
}
export function assertMaskDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 128 || height < 128 || width > 1024 || height > 1024) throw new Error('Invalid bounded mask dimensions');
}
