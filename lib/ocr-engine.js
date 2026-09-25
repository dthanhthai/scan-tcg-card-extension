// Wraps Tesseract.js for reading the bottom-left card code. Runs in the
// scanner page (needs DOM/canvas access), NOT in the service worker.
//
// Tesseract.js is bundled locally under vendor/tesseract/ (Chrome extensions
// cannot load remote scripts/CDNs per Manifest V3 policy). Load order in
// scanner.html:
//   <script src="../vendor/tesseract/tesseract.min.js"></script>  (defines window.Tesseract)
//   <script src="ocr-engine.js"></script> (this file)
//
// workerBlobURL is set to false so the worker is created directly from our
// extension's own worker.min.js (chrome-extension:// origin) instead of a
// blob: URL. This keeps every subsequent importScripts()/fetch() the worker
// makes (for the core .wasm and the language data) same-origin, so no
// web_accessible_resources entry is needed.

let ocrWorkerPromise = null;
let tesseractScriptPromise = null;

function loadTesseractScript() {
  if (tesseractScriptPromise) return tesseractScriptPromise;
  if (typeof Tesseract !== 'undefined') return Promise.resolve();
  tesseractScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('vendor/tesseract/tesseract.min.js');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createOcrWorker();
  }
  return ocrWorkerPromise;
}

async function createOcrWorker() {
  await loadTesseractScript();
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd-lstm.wasm.js'),
    langPath: chrome.runtime.getURL('vendor/tesseract/lang-data'),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
  });

  // Restrict recognition to Latin letters, digits, and the punctuation that
  // appears in a card code (/ - . and space). This excludes Japanese glyphs
  // from the illustrator line, which reduces false positives significantly.
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-. ',
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
  });

  return worker;
}

/**
 * Runs OCR on a preprocessed canvas (see utils/image-processor.js) and
 * returns the raw recognized text (whitespace-trimmed).
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<string>}
 */
async function recognizeCardCode(canvas) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas);
  return data.text.trim();
}
