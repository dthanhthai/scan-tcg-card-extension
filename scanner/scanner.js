// Scanner page logic: image upload + snapshot -> OCR -> editable
// fields -> card/price lookup. Depends on utils/image-processor.js,
// utils/card-code-parser.js, lib/ocr-engine.js, and utils/card-lookup.js
// (all loaded via <script> tags in scanner.html).

let knownSetCodes = [];
let lastMediaDimensions = null;
let lastCardNameJp = null;
let lastCrossSetCode = null;
let lastCrossCardNumber = null;
let lastCrossSetName = null;
let lastIsPromo = false;
// Blocks a second lookup while one is running: the auto look-up and a click can
// otherwise race, and two lookups open twice the marketplace windows.
let isLookingUp = false;

const el = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  loadKnownSetCodes();

  window.addEventListener('resize', () => {
    if (lastMediaDimensions) updateCropGuide(lastMediaDimensions.width, lastMediaDimensions.height);
  });

  el('uploadBtn').addEventListener('click', () => el('fileInput').click());
  el('fileInput').addEventListener('change', onFileInputChange);
  el('retryBtn').addEventListener('click', resetCaptureStage);
  el('lookupBtn').addEventListener('click', onLookupClick);

  // Enter runs the lookup from anywhere on the page, so the mouse is not needed
  // after typing and no field has to be focused first. Copy buttons and the
  // Language/Promo controls keep their own Enter.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target.closest('button, select')) return;
    event.preventDefault();
    onLookupClick();
  });

  ['setCodeInput', 'cardNumberInput'].forEach((id) => {
    el(id).addEventListener('input', () => {
      const nameInput = el('cardNameInput');
      if (nameInput.dataset.autofilled === '1') {
        nameInput.value = '';
        delete nameInput.dataset.autofilled;
      }
    });
  });

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-copy');
      const input = el(targetId);
      if (!input) return;
      navigator.clipboard.writeText(input.value).then(() => {
        btn.classList.add('copied');
        btn.textContent = '✓';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = '📋';
        }, 1500);
      });
    });
  });

  const stage = el('captureStage');
  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('drag-over');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag-over'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImageSource(file);
  });

  document.addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) handleImageSource(item.getAsFile());
  });

  if (window.location.hash === '#snapshot') {
    console.log('[snapshot] hash detected, starting snapshot from storage');
    document.title = '[Snapshot] Pokemon TCG Card Scanner';
    startSnapshotFromStorage();
  } else if (window.location.hash === '#upload') {
    console.log('[upload] hash detected, loading uploaded image from storage');
    startUploadFromStorage();
  } else if (window.location.hash === '#manual') {
    console.log('[manual] hash detected, loading manual search data from storage');
    startManualSearchFromStorage();
  } else {
    console.log('[scanner] no hash, normal mode. hash=', window.location.hash);
  }
});

function updateCropGuide(naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return;
  lastMediaDimensions = { width: naturalWidth, height: naturalHeight };

  const stage = el('captureStage');
  const guide = el('cropGuide');
  const containerW = stage.clientWidth;
  const containerH = stage.clientHeight;
  const containerRatio = containerW / containerH;
  const mediaRatio = naturalWidth / naturalHeight;

  let renderedW;
  let renderedH;
  let offsetX;
  let offsetY;
  if (mediaRatio > containerRatio) {
    renderedW = containerW;
    renderedH = containerW / mediaRatio;
    offsetX = 0;
    offsetY = (containerH - renderedH) / 2;
  } else {
    renderedH = containerH;
    renderedW = containerH * mediaRatio;
    offsetY = 0;
    offsetX = (containerW - renderedW) / 2;
  }

  guide.style.left = `${offsetX}px`;
  guide.style.bottom = `${offsetY}px`;
  guide.style.width = `${renderedW * CARD_CODE_CROP.widthFraction}px`;
  guide.style.height = `${renderedH * (1 - CARD_CODE_CROP.topFraction)}px`;
}

async function loadKnownSetCodes() {
  const cached = await getCachedSets();
  if (cached) {
    knownSetCodes = cached;
    return;
  }

  const [jaRes, enRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FETCH_ALL_SETS, payload: { language: 'ja' } }),
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.FETCH_ALL_SETS, payload: { language: 'en' } }),
  ]);

  const ids = new Set();
  if (jaRes.success) jaRes.data.forEach((s) => ids.add(s.id));
  if (enRes.success) enRes.data.forEach((s) => ids.add(s.id));

  knownSetCodes = [...ids];
  if (knownSetCodes.length > 0) await cacheSets(knownSetCodes);
}

function onFileInputChange(event) {
  const file = event.target.files && event.target.files[0];
  if (file) handleImageSource(file);
}

async function handleImageSource(fileOrBlob) {
  try {
    const canvas = await loadImageToCanvas(fileOrBlob);
    showCapturedImage(canvas.toDataURL('image/png'), canvas.width, canvas.height);
    await processCapturedCanvas(canvas);
  } catch (err) {
    showStatus(`Could not load image: ${err.message}`, true);
  }
}

function showCapturedImage(dataUrl, naturalWidth, naturalHeight) {
  el('dropZone').classList.add('hidden');
  const img = el('previewImage');
  img.src = dataUrl;
  img.classList.remove('hidden');
  el('captureStage').classList.add('show-guide');
  updateCropGuide(naturalWidth, naturalHeight);

  el('uploadBtn').classList.add('hidden');
  el('retryBtn').classList.remove('hidden');
}

function resetCaptureStage() {
  lastMediaDimensions = null;
  el('dropZone').classList.remove('hidden');
  el('previewImage').classList.add('hidden');
  el('captureStage').classList.remove('show-guide');

  el('uploadBtn').classList.remove('hidden');
  el('retryBtn').classList.add('hidden');

  el('ocrSection').classList.add('hidden');
  el('resultArea').classList.add('hidden');
  hideStatus();
}

async function processCapturedCanvas(fullCanvas) {
  showStatus('<span class="loading-spinner" aria-hidden="true"></span> Gemini loading...');

  const qualityLevel = await getImageQualitySetting();
  const maxSize = IMAGE_QUALITY_MAX_SIZE[qualityLevel] || 1024;
  const jpegQuality = IMAGE_QUALITY_JPEG_QUALITY[qualityLevel] || 0.7;
  const resizedCanvas = resizeCanvasForGemini(fullCanvas, maxSize);
  const base64 = canvasToBase64Jpeg(resizedCanvas, jpegQuality);
  const geminiResult = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.RECOGNIZE_CARD_CODE,
    payload: { imageBase64: base64 },
  });

  if (geminiResult.success) {
    el('ocrRawLabel').textContent = 'AI read:';
    el('ocrRawText').textContent = summarizeGeminiRead(geminiResult.data);
    // The full JSON stays reachable on hover (and in the console log above).
    el('ocrRawText').title = JSON.stringify(geminiResult.data);
    el('setCodeInput').value = geminiResult.data.setCode || '';
    el('setNameInput').value = geminiResult.data.setName || '';
    el('cardNumberInput').value = geminiResult.data.cardNumber || '';
    el('rarityInput').value = geminiResult.data.rarityCode || '';
    el('cardNameInput').value = geminiResult.data.cardName || '';
    el('languageInput').value = geminiResult.data.language || '';
    lastCardNameJp = geminiResult.data.cardNameJp || null;
    lastCrossSetCode = geminiResult.data.crossSetCode || null;
    lastCrossCardNumber = geminiResult.data.crossCardNumber || null;
    lastCrossSetName = geminiResult.data.crossSetName || null;
    lastIsPromo = geminiResult.data.isPromo === true;
    el('promoInput').checked = lastIsPromo;
    el('ocrPreview').classList.add('hidden');
    hideStatus();
    el('ocrSection').classList.remove('hidden');
    // No field is focused here: a focused text input always draws the accent
    // focus ring, which reads as an error on a field the model just filled.
    // Enter still runs the lookup without focus (handler on document).
    if (!geminiResult.data.cardNumber) {
      showStatus('AI could not read the card number. Please check the fields below.', true);
    } else if (!geminiResult.data.setCode && !geminiResult.data.setName) {
      showStatus('AI could not read the set code or set name. Please check the fields below.', true);
    }
    maybeAutoLookup();
    return;
  }

  if (geminiResult.error !== 'NO_API_KEY') {
    console.warn('Gemini failed, falling back to OCR:', geminiResult.error);
  }

  await runOcrPipeline(fullCanvas);
}

async function runOcrPipeline(fullCanvas) {
  showStatus('Reading card code (OCR)...');

  const croppedCanvas = preprocessCardImage(fullCanvas);

  const previewCanvas = el('ocrCropCanvas');
  previewCanvas.width = croppedCanvas.width;
  previewCanvas.height = croppedCanvas.height;
  previewCanvas.getContext('2d').drawImage(croppedCanvas, 0, 0);
  el('ocrPreview').classList.remove('hidden');

  let rawText = '';
  try {
    rawText = await recognizeCardCode(croppedCanvas);
  } catch (err) {
    showStatus(`OCR failed: ${err.message}`, true);
    return;
  }

  el('ocrRawLabel').textContent = 'Raw OCR text:';
  el('ocrRawText').textContent = rawText || '(no text detected)';

  const parsed = parseCardCode(rawText);
  const correctedSetCode = parsed && parsed.setCode
    ? correctSetCodeAgainstKnownList(parsed.setCode, knownSetCodes)
    : '';
  el('setCodeInput').value = correctedSetCode;
  el('cardNumberInput').value = parsed && parsed.cardNumber ? parsed.cardNumber : '';
  el('rarityInput').value = parsed && parsed.rarityCode ? parsed.rarityCode : '';

  hideStatus();
  el('ocrSection').classList.remove('hidden');

  if (!parsed) {
    showStatus('Could not detect a card code. Try a clearer photo, or enter the set code and number manually below.', true);
  }
  maybeAutoLookup();
}

// One readable line describing what the model returned. The editable fields
// below repeat the parsed values, so this is mainly for spotting a field the
// model got wrong — a raw JSON dump was hard to read there.
function summarizeGeminiRead(data) {
  const fields = [
    ['name', data.cardName],
    ['nameJp', data.cardNameJp],
    ['setCode', data.setCode],
    ['setName', data.setName],
    ['cardNumber', data.cardNumber],
    ['rarity', data.rarityCode],
    ['language', data.language],
  ];
  const parts = fields.filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
  const cross = [data.crossSetCode, data.crossCardNumber].filter(Boolean).join(' ');
  if (cross) parts.push(`cross: ${cross}`);
  if (data.crossSetName) parts.push(`crossSet: ${data.crossSetName}`);
  if (data.isPromo) parts.push('promo: yes');
  return parts.join(' · ') || '(nothing read)';
}

function canvasToBase64Jpeg(canvas, quality = 0.85) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

// Image quality levels for Gemini Vision API.
// Higher resolution = better detection of small text (set codes, card numbers)
// but costs more API tokens. Lower resolution = faster and cheaper but may
// miss small or faint text on cards.
//   original: no resize, full resolution — highest cost (~14 tiles for 3362px image)
//   high:   max 1536px, JPEG quality 0.85 — best for small/faint text (~4 tiles)
//   medium: max 1024px, JPEG quality 0.70 — balanced, good for most cards (~2 tiles)
//   low:    max 768px,  JPEG quality 0.60 — fastest/cheapest, may miss small text (~1 tile)
const IMAGE_QUALITY_MAX_SIZE = { original: 0, high: 1536, medium: 1024, low: 768 };
const IMAGE_QUALITY_JPEG_QUALITY = { original: 0.85, high: 0.85, medium: 0.7, low: 0.6 };

function resizeCanvasForGemini(sourceCanvas, maxSize) {
  if (!maxSize || maxSize <= 0) return sourceCanvas;
  const longestSide = Math.max(sourceCanvas.width, sourceCanvas.height);
  if (longestSide <= maxSize) return sourceCanvas;
  const scale = maxSize / longestSide;
  const outW = Math.max(1, Math.round(sourceCanvas.width * scale));
  const outH = Math.max(1, Math.round(sourceCanvas.height * scale));
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  outCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, outW, outH);
  console.log('[gemini] resized image:', sourceCanvas.width, 'x', sourceCanvas.height, '->', outW, 'x', outH);
  return outCanvas;
}

async function getImageQualitySetting() {
  const settings = await getSettings();
  return settings.imageQuality || 'medium';
}

// Runs the lookup as soon as the fields are ready, so a scan needs no second
// click. On by default; the settings page can turn it off. Skipped when the
// fields cannot produce a lookup anyway, so the "could not read" hint stays
// visible instead of a confusing lookup error.
async function maybeAutoLookup() {
  const settings = await getSettings();
  if (settings.autoLookup === false) return;
  const hasNumber = !!el('cardNumberInput').value.trim();
  const hasIdentity = !!(el('setCodeInput').value.trim() || el('cardNameInput').value.trim());
  if (!hasNumber || !hasIdentity) return;
  onLookupClick();
}

async function onLookupClick() {
  const setCode = el('setCodeInput').value.trim();
  const setNameInput = el('setNameInput').value.trim() || null;
  const cardNumberRaw = el('cardNumberInput').value.trim();
  const rarityCodeInput = el('rarityInput').value.trim();
  const cardNameInput = el('cardNameInput').value.trim();
  const languageInput = el('languageInput').value.trim() || null;

  const isAutoFilled = el('cardNameInput').dataset.autofilled === '1';
  const effectiveCardName = isAutoFilled ? '' : cardNameInput;
  let resolvedCardName = null;

  const localIdMatch = cardNumberRaw.match(/^(\d{1,3})\//);
  const localId = localIdMatch ? localIdMatch[1].padStart(3, '0') : cardNumberRaw.padStart(3, '0');

  if (!localId) {
    showStatus('Enter a card number, e.g. "017/193".', true);
    return;
  }
  if (!setCode && !cardNameInput) {
    showStatus('Enter a set code or card name.', true);
    return;
  }
  if (isAutoFilled) {
    el('cardNameInput').value = '';
    el('cardNameInput').removeAttribute('data-autofilled');
  }
  if (isLookingUp) return;
  isLookingUp = true;

  const lookupBtn = el('lookupBtn');
  lookupBtn.disabled = true;
  lookupBtn.innerHTML = '🔍 Searching...';

  el('resultArea').classList.add('hidden');
  const crossVersionWrapper = document.querySelector('.cross-version-wrapper');
  if (crossVersionWrapper) crossVersionWrapper.remove();
  const progressStates = {};
  showProgressSteps(progressStates);

  const result = await lookupCardAndPrice(
    setCode, localId, cardNumberRaw, rarityCodeInput, effectiveCardName, languageInput, setNameInput,
    (stepId, status, detail) => {
      progressStates[stepId] = { status, detail };
      showProgressSteps(progressStates);
    },
    lastCardNameJp,
    false,
    lastCrossSetCode,
    lastCrossCardNumber,
    lastCrossSetName,
    el('promoInput').checked,
  ).catch((err) => {
    console.error('[scanner] lookup failed:', err);
    return { success: false, error: `Lookup failed: ${err.message}` };
  });
  isLookingUp = false;
  hideStatus();

  lookupBtn.disabled = false;
  lookupBtn.innerHTML = '🔍 Look Up Card';

  if (!result.success) {
    showStatus(result.error, true);
    return;
  }

  if (!effectiveCardName) {
    const cardName = (result.card && result.card.name) ? result.card.name : (result.resolvedCardName || resolvedCardName);
    if (cardName) {
      el('cardNameInput').value = cardName;
      el('cardNameInput').dataset.autofilled = '1';
    }
  }

  await renderCardResult(el('resultArea'), result);
}

function showStatus(message, isError = false) {
  const status = el('statusArea');
  status.innerHTML = message;
  status.classList.remove('hidden');
  status.classList.toggle('error', isError);
}

function showProgressSteps(stepStates) {
  const status = el('statusArea');
  status.innerHTML = `<div class="progress-steps">${renderProgressSteps(stepStates)}</div>`;
  status.classList.remove('hidden');
  status.classList.remove('error');
}

function hideStatus() {
  el('statusArea').classList.add('hidden');
}

let snapshotDragStart = null;

function positionSnapshotImg(canvas) {
  const overlay = el('snapshotOverlay');
  const overlayRect = overlay.getBoundingClientRect();
  const borderW = (overlayRect.width - overlay.clientWidth) / 2;
  const borderH = (overlayRect.height - overlay.clientHeight) / 2;
  const contentW = overlay.clientWidth;
  const contentH = overlay.clientHeight;
  const scale = Math.min(contentW / canvas.width, contentH / canvas.height);
  const displayedW = canvas.width * scale;
  const displayedH = canvas.height * scale;
  const left = overlayRect.left + borderW + (contentW - displayedW) / 2;
  const top = overlayRect.top + borderH + (contentH - displayedH) / 2;
  const img = el('snapshotImg');
  img.style.position = 'fixed';
  img.style.left = `${left}px`;
  img.style.top = `${top}px`;
  img.style.width = `${displayedW}px`;
  img.style.height = `${displayedH}px`;
  img.classList.remove('hidden');
}

function setupSnapshotDrag(overlay, canvas) {
  const selection = el('snapshotSelection');
  const onKey = (e) => {
    if (e.key === 'Escape') {
      cleanup();
    }
  };
  const onMouseDown = (e) => {
    snapshotDragStart = { x: e.clientX, y: e.clientY };
    selection.style.left = `${e.clientX}px`;
    selection.style.top = `${e.clientY}px`;
    selection.style.width = '0px';
    selection.style.height = '0px';
    selection.style.display = 'block';
  };
  const onMouseMove = (e) => {
    if (!snapshotDragStart) return;
    const left = Math.min(snapshotDragStart.x, e.clientX);
    const top = Math.min(snapshotDragStart.y, e.clientY);
    const width = Math.abs(e.clientX - snapshotDragStart.x);
    const height = Math.abs(e.clientY - snapshotDragStart.y);
    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${width}px`;
    selection.style.height = `${height}px`;
  };
  const onMouseUp = (e) => {
    if (!snapshotDragStart) return;
    const rect = {
      left: Math.min(snapshotDragStart.x, e.clientX),
      top: Math.min(snapshotDragStart.y, e.clientY),
      width: Math.abs(e.clientX - snapshotDragStart.x),
      height: Math.abs(e.clientY - snapshotDragStart.y),
    };
    snapshotDragStart = null;
    if (rect.width < 10 || rect.height < 10) {
      cleanup();
      return;
    }
    cropSnapshotToCanvas(canvas, rect);
    cleanup();
  };

  function cleanup() {
    overlay.classList.add('hidden');
    el('snapshotImg').classList.add('hidden');
    selection.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function cropSnapshotToCanvas(sourceCanvas, screenRect) {
  const img = el('snapshotImg');
  const imgRect = img.getBoundingClientRect();
  const scaleX = sourceCanvas.width / imgRect.width;
  const scaleY = sourceCanvas.height / imgRect.height;
  // Asymmetric padding: shrink top/left (had extra), keep right/bottom
  const padTopLeft = -3;
  const padRightBottom = 3;
  let sx = (screenRect.left - imgRect.left - padTopLeft) * scaleX;
  let sy = (screenRect.top - imgRect.top - padTopLeft) * scaleY;
  let sw = (screenRect.width + padTopLeft + padRightBottom) * scaleX;
  let sh = (screenRect.height + padTopLeft + padRightBottom) * scaleY;

  // Clamp to canvas bounds to avoid missing edges
  if (sx < 0) { sw += sx; sx = 0; }
  if (sy < 0) { sh += sy; sy = 0; }
  if (sx + sw > sourceCanvas.width) { sw = sourceCanvas.width - sx; }
  if (sy + sh > sourceCanvas.height) { sh = sourceCanvas.height - sy; }
  if (sw <= 0 || sh <= 0) return;

  const cropped = document.createElement('canvas');
  cropped.width = Math.round(sw);
  cropped.height = Math.round(sh);
  cropped.getContext('2d').drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  img.classList.add('hidden');
  img.style.position = '';

  el('previewImage').src = cropped.toDataURL('image/jpeg', 0.92);
  el('previewImage').classList.remove('hidden');
  el('dropZone').classList.add('hidden');
  el('retryBtn').classList.remove('hidden');

  processCapturedCanvas(cropped);
}

// The service worker stores the snapshot in parallel with opening this tab, so
// the payload can land slightly after the page has loaded. Poll briefly instead
// of failing on the first empty read.
async function takeSnapshotDataWithWait(timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const dataUrl = await takeSnapshotData();
    if (dataUrl) return dataUrl;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function startSnapshotFromStorage() {
  const startedAt = Date.now();
  console.log('[snapshot] startSnapshotFromStorage called');
  const overlay = el('snapshotOverlay');
  const hint = document.querySelector('.snapshot-hint');
  // Show the capture overlay right away: the red frame is the user's feedback
  // that the hotkey was received, and it should not wait for the stored image to
  // be read and decoded. Dragging stays disabled until the image is drawn.
  overlay.classList.remove('hidden');
  if (hint) hint.textContent = 'Loading screenshot...';
  showStatus('Loading screenshot...');

  let dataUrl;
  try {
    dataUrl = await takeSnapshotDataWithWait();
  } catch (err) {
    console.error('[snapshot] storage read error:', err);
    overlay.classList.add('hidden');
    showStatus(`Storage read error: ${err.message}`, true);
    return;
  }
  if (!dataUrl) {
    console.warn('[snapshot] no snapshotData in storage');
    overlay.classList.add('hidden');
    showStatus('No screenshot data found in storage.', true);
    return;
  }
  console.log('[snapshot] snapshot read in', Date.now() - startedAt, 'ms, payload', Math.round(dataUrl.length / 1024), 'KB');

  const img = el('snapshotImg');
  const canvas = el('snapshotCanvas');
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    img.onload = null;

    hideStatus();
    positionSnapshotImg(canvas);
    if (hint) hint.textContent = 'Drag to select the card region. Press Esc to cancel.';
    setupSnapshotDrag(overlay, canvas);
    console.log('[snapshot] image drawn and overlay ready in', Date.now() - startedAt, 'ms');
  };
  img.onerror = (e) => {
    console.error('[snapshot] img onerror', e);
    overlay.classList.add('hidden');
    showStatus('Failed to load screenshot image data.', true);
  };
  img.src = dataUrl;
}

async function startUploadFromStorage() {
  console.log('[upload] startUploadFromStorage called');
  showStatus('Loading uploaded image...');
  let result;
  try {
    result = await chrome.storage.local.get('uploadImageData');
  } catch (err) {
    console.error('[upload] storage read error:', err);
    showStatus(`Storage read error: ${err.message}`, true);
    return;
  }

  const dataUrl = result.uploadImageData;
  if (!dataUrl) {
    console.warn('[upload] no uploadImageData in storage');
    showStatus('No uploaded image found in storage.', true);
    return;
  }

  await chrome.storage.local.remove('uploadImageData');

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await handleImageSource(blob);
  } catch (err) {
    console.error('[upload] failed to process image:', err);
    showStatus(`Failed to load image: ${err.message}`, true);
  }
}

async function startManualSearchFromStorage() {
  console.log('[manual] startManualSearchFromStorage called');
  let result;
  try {
    result = await chrome.storage.local.get('manualSearchData');
  } catch (err) {
    console.error('[manual] storage read error:', err);
    showStatus(`Storage read error: ${err.message}`, true);
    return;
  }

  const data = result.manualSearchData;
  if (!data) {
    console.warn('[manual] no manualSearchData in storage');
    showStatus('No search data found in storage.', true);
    return;
  }

  await chrome.storage.local.remove('manualSearchData');

  el('setCodeInput').value = data.setCode || '';
  el('setNameInput').value = '';
  el('cardNumberInput').value = data.cardNumberFull || data.localId || '';
  el('rarityInput').value = '';
  el('cardNameInput').value = data.cardName || '';
  el('languageInput').value = data.language || '';
  el('ocrRawLabel').textContent = 'Manual input:';
  el('ocrRawText').textContent = [data.setCode, data.cardNumberFull || data.localId, data.cardName].filter(Boolean).join(' · ');
  el('ocrPreview').classList.add('hidden');
  el('ocrSection').classList.remove('hidden');
  el('uploadBtn').classList.add('hidden');
  el('retryBtn').classList.remove('hidden');
  el('dropZone').classList.add('hidden');
  maybeAutoLookup();
}
