'use strict';

const { nativeImage } = require('electron');

function measureImage(filename) {
  const image = nativeImage.createFromPath(filename);
  const { width, height } = image.getSize();
  if (!width || !height) throw new Error(`Could not decode pet image: ${filename}`);
  const pixels = image.toBitmap();
  let bottomTransparentRows = height;
  for (let y = height - 1; y >= 0; y -= 1) {
    let visible = false;
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 16) {
        visible = true;
        break;
      }
    }
    if (visible) {
      bottomTransparentRows = height - 1 - y;
      break;
    }
  }
  if (bottomTransparentRows === height) throw new Error(`Pet image is fully transparent: ${filename}`);
  return { width, height, bottomTransparentRows };
}

module.exports = { measureImage };
