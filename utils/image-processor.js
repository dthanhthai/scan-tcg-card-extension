// Crops and enhances the bottom-left region of a card image for OCR.
// All processing uses the <canvas> API — no external libraries needed.
// Runs in the scanner page.

/**
 * Given a canvas holding the full card photo, returns a new canvas
 * containing just the bottom-left "code" region, upscaled and thresholded
 * for better OCR accuracy.
 *
 * The crop region (see constants.js#CARD_CODE_CROP) targets where the
 * regulation mark / set code / card number / rarity line sits on virtually
 * every Pokemon TCG card, while trying to exclude the illustrator credit
 * line just above it and the black rule-text bar (e.g. "exルール") to its
 * right, both of which confuse the OCR engine if included.
 *
 * Thresholding is adaptive, not a fixed cutoff, because cards vary a lot in
 * how this strip is styled: some print dark text on a plain light
 * background, others print light/white text on a dark translucent bar
 * (common on holo/textured card art). A fixed threshold works for the
 * former and produces a near-solid black, speckled mess for the latter
 * (which Tesseract then reads as nothing). Two steps handle this:
 *  1. Otsu's method picks the threshold that best separates the crop's own
 *     light/dark pixels, instead of assuming a fixed brightness cutoff.
 *  2. After thresholding, if the result is majority-black, it's inverted
 *     so the output is always dark text on a light background — the
 *     polarity Tesseract is tuned for — regardless of the original card's
 *     color scheme.
 * A 5x5 median filter is applied before thresholding to remove card
 * texture/holo speckle. A box blur (simple averaging) was tried first but
 * left the surrounding speckle intact enough to still confuse Tesseract's
 * line segmentation, even when the text itself remained legible in the
 * blurred image — a median filter (each pixel replaced by the median of
 * its neighborhood) suppresses that kind of salt-and-pepper noise far more
 * effectively while still preserving the much larger, solid text strokes.
 *
 * IMPORTANT: this assumes sourceCanvas is tightly cropped to the card face
 * itself (minimal surrounding background/padding). A screenshot or photo
 * with lots of empty space around the card will throw off these fixed
 * percentages — frame the card to fill the capture area for best results.
 *
 * @param {HTMLCanvasElement} sourceCanvas - full card image
 * @param {object} [options]
 * @param {number} [options.cropTopFraction=CARD_CODE_CROP.topFraction] - where the crop starts (as a fraction of height)
 * @param {number} [options.cropWidthFraction=CARD_CODE_CROP.widthFraction] - how much of the width to keep
 * @param {number} [options.scale=3] - upscale factor applied to the crop
 * @returns {HTMLCanvasElement}
 */
function preprocessCardImage(sourceCanvas, options = {}) {
  const {
    cropTopFraction = CARD_CODE_CROP.topFraction,
    cropWidthFraction = CARD_CODE_CROP.widthFraction,
    scale = 3,
  } = options;

  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  const cropX = 0;
  const cropY = Math.floor(srcH * cropTopFraction);
  const cropW = Math.floor(srcW * cropWidthFraction);
  const cropH = srcH - cropY;

  const outW = Math.max(1, Math.floor(cropW * scale));
  const outH = Math.max(1, Math.floor(cropH * scale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const ctx = outCanvas.getContext('2d');

  ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  const imageData = ctx.getImageData(0, 0, outW, outH);
  const pixels = imageData.data;
  const pixelCount = outW * outH;

  const gray = new Uint8ClampedArray(pixelCount);
  for (let p = 0, i = 0; p < pixelCount; p += 1, i += 4) {
    gray[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  const denoised = medianFilter(gray, outW, outH, 3);
  const threshold = computeOtsuThreshold(denoised);

  let blackCount = 0;
  for (let p = 0; p < pixelCount; p += 1) {
    if (denoised[p] < threshold) blackCount += 1;
  }
  // If more than half the pixels ended up black, the crop is light text on
  // a dark background — invert so the output is always dark-on-light.
  const invert = blackCount > pixelCount / 2;

  for (let p = 0, i = 0; p < pixelCount; p += 1, i += 4) {
    let isBlack = denoised[p] < threshold;
    if (invert) isBlack = !isBlack;
    const value = isBlack ? 0 : 255;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return outCanvas;
}

/**
 * Median filter over a single-channel (grayscale) buffer: each pixel is
 * replaced by the median value within a (2*radius+1)x(2*radius+1)
 * neighborhood. Much more effective than an averaging blur at removing
 * salt-and-pepper-style noise (card texture/holo speckle) without eroding
 * solid text strokes, which are typically wider than the noise.
 * @param {Uint8ClampedArray} gray
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Uint8ClampedArray}
 */
function medianFilter(gray, width, height, radius) {
  const out = new Uint8ClampedArray(gray.length);
  const windowSize = (radius * 2 + 1) * (radius * 2 + 1);
  const buf = new Uint8ClampedArray(windowSize);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          buf[n] = gray[ny * width + nx];
          n += 1;
        }
      }
      out[y * width + x] = quickSelectMedian(buf, n);
    }
  }
  return out;
}

/**
 * Returns the median of the first `count` values in `buf` without a full
 * sort (partial selection sort up to the midpoint) — cheaper than
 * Array.sort() when this runs once per pixel.
 * @param {Uint8ClampedArray} buf
 * @param {number} count
 * @returns {number}
 */
function quickSelectMedian(buf, count) {
  const mid = Math.floor(count / 2);
  for (let i = 0; i <= mid; i += 1) {
    let minIdx = i;
    for (let j = i + 1; j < count; j += 1) {
      if (buf[j] < buf[minIdx]) minIdx = j;
    }
    if (minIdx !== i) {
      const tmp = buf[i];
      buf[i] = buf[minIdx];
      buf[minIdx] = tmp;
    }
  }
  return buf[mid];
}

/**
 * Otsu's method: finds the grayscale threshold that best separates a
 * bimodal (light-cluster / dark-cluster) histogram, i.e. background vs
 * text, without assuming a fixed brightness cutoff.
 * @param {Uint8ClampedArray} gray
 * @returns {number} threshold in [0, 255]
 */
function computeOtsuThreshold(gray) {
  const histogram = new Array(256).fill(0);
  for (let p = 0; p < gray.length; p += 1) histogram[gray[p]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    weightB += histogram[i];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;

    sumB += i * histogram[i];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

/**
 * Loads an image (File, Blob, or data URL string) into a canvas sized to
 * match the image's natural dimensions.
 * @param {File|Blob|string} source
 * @returns {Promise<HTMLCanvasElement>}
 */
function loadImageToCanvas(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (typeof source !== 'string') URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}