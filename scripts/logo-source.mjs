// Shared source prep for the logo derivatives.
//
// public/logo.png is a circular seal sitting on a cream field, and it is not
// exactly square. Both logo.webp and favicon.ico want the seal itself, centered
// in a square frame — so trim the flat border, then pad the shorter axis back
// out with the same cream so nothing is cropped off the artwork.
import sharp from 'sharp';

export const SRC = 'public/logo.png';

/** PNG buffer of the seal, trimmed and padded to a square.
 *  Returned as a buffer, not a pipeline: sharp applies `extend` after `resize`
 *  regardless of call order, so the padding has to be baked in first. */
export async function squareLogo() {
  // Sample the corner for the field color the trim will pad back with.
  const { data } = await sharp(SRC)
    .extract({ left: 0, top: 0, width: 8, height: 8 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };

  const trimmed = await sharp(SRC).trim({ threshold: 12 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const side = Math.max(meta.width, meta.height);

  return sharp(trimmed)
    .extend({
      top: Math.floor((side - meta.height) / 2),
      bottom: Math.ceil((side - meta.height) / 2),
      left: Math.floor((side - meta.width) / 2),
      right: Math.ceil((side - meta.width) / 2),
      background,
    })
    .png()
    .toBuffer();
}
