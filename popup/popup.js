// Popup logic: manual search, results display, recent scans list.
// Depends on constants.js and storage.js (loaded via <script> tags in popup.html).

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  updateGeminiStatus();
  preloadSetData();

  document.getElementById('searchForm').addEventListener('submit', onSearchSubmit);
  document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', onFileInputChange);
  document.getElementById('snapshotBtn').addEventListener('click', onSnapshot);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('geminiTestBtn').addEventListener('click', testGeminiApi);
});

async function preloadSetData() {
  const overlay = document.getElementById('preloadOverlay');
  try {
    // Check if cache already exists before showing overlay
    const result = await chrome.storage.local.get([STORAGE_KEYS.SET_LIST_CACHE, 'setAbbreviationMap']);
    const setListCache = result[STORAGE_KEYS.SET_LIST_CACHE] || {};
    const abbrCache = result['setAbbreviationMap'] || {};
    const enSets = setListCache.en && setListCache.en.data ? setListCache.en.data.length : 0;
    const jaSets = setListCache.ja && setListCache.ja.data ? setListCache.ja.data.length : 0;
    const enAbbr = abbrCache.en && abbrCache.en.data ? Object.keys(abbrCache.en.data).length : 0;
    const jaAbbr = abbrCache.ja && abbrCache.ja.data ? Object.keys(abbrCache.ja.data).length : 0;
    console.log('[popup] cache check:', { enSets, jaSets, enAbbr, jaAbbr });
    // EN needs sets + abbreviations; JA only needs sets (JP sets don't have abbreviations)
    if (enSets > 0 && enAbbr > 0 && jaSets > 0) {
      console.log('[popup] set data already cached, skipping preload');
      return;
    }
    // Cache missing — show overlay and preload
    console.log('[popup] cache incomplete, showing overlay');
    overlay.classList.remove('hidden');
    const res = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PRELOAD_SETS,
      payload: {},
    });
    if (!res || !res.success) {
      console.warn('[popup] preload failed, will fetch on demand');
    }
  } catch (err) {
    console.warn('[popup] preload error:', err.message);
  } finally {
    overlay.classList.add('hidden');
  }
}

async function updateGeminiStatus() {
  const el = document.getElementById('geminiStatus');
  try {
    const settings = await getSettings();
    if (settings.geminiApiKey) {
      el.textContent = 'Gemini API: Active';
      el.className = 'gemini-status active';
    } else {
      el.textContent = 'Gemini API: No key (OCR fallback)';
      el.className = 'gemini-status inactive';
    }
  } catch (err) {
    el.textContent = 'Gemini API: ?';
    el.className = 'gemini-status inactive';
  }
}

async function testGeminiApi() {
  const el = document.getElementById('geminiStatus');
  const btn = document.getElementById('geminiTestBtn');
  btn.disabled = true;
  el.textContent = 'Gemini API: Testing...';
  el.className = 'gemini-status testing';
  try {
    const settings = await getSettings();
    if (!settings.geminiApiKey) {
      el.textContent = 'Gemini API: No key (OCR fallback)';
      el.className = 'gemini-status inactive';
      return;
    }
    const url = `${GEMINI_API_URL}?key=${settings.geminiApiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      }),
    });
    if (response.ok) {
      el.textContent = 'Gemini API: Active (verified)';
      el.className = 'gemini-status active';
    } else {
      const body = await response.text();
      el.textContent = `Gemini API: Error ${response.status}`;
      el.className = 'gemini-status inactive';
      console.error('[gemini] test failed:', response.status, body.substring(0, 200));
    }
  } catch (err) {
    el.textContent = `Gemini API: ${err.message}`;
    el.className = 'gemini-status inactive';
  } finally {
    btn.disabled = false;
  }
}

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
}

async function onFileInputChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  await chrome.storage.local.set({ uploadImageData: await fileToDataUrl(file) });
  await chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') + '#upload' });
  window.close();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function onSnapshot() {
  showStatus('Capturing current tab...');
  try {
    const win = await chrome.windows.getCurrent();
    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 85 });
    if (!dataUrl || dataUrl.length < 100) {
      throw new Error('captureVisibleTab returned empty data');
    }
    // The scanner page polls for the payload, so the write and the new tab can
    // run in parallel.
    await Promise.all([
      setSnapshotData(dataUrl),
      chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') + '#snapshot' }),
    ]);
    window.close();
  } catch (err) {
    console.error('Snapshot error:', err);
    showStatus(`Capture failed: ${err.message}`, true);
  }
}

/**
 * Parses manual search input into { setCode, localId, cardNumberFull, cardName }.
 * Accepts:
 *   "M2a-017", "M2a 017", "s10b 028/071", "017/193 M2a", "017/193"
 *   "Pikachu 028/071", "Pikachu 028/071 s10b", "Pikachu s10b 028/071"
 */
function parseSearchInput(input) {
  const trimmed = input.trim();

  // Detect language suffix: "JP", "EN", "JA" at the end (case-insensitive)
  const langMatch = trimmed.match(/\s+(JP|EN|JA)$/i);
  let language = null;
  let withoutLang = trimmed;
  if (langMatch) {
    const lang = langMatch[1].toUpperCase();
    language = (lang === 'JP' || lang === 'JA') ? 'ja' : 'en';
    withoutLang = trimmed.slice(0, langMatch.index).trim();
  }

  const parsed = parseSearchInputCore(withoutLang);
  if (!parsed) return null;
  parsed.language = language;
  return parsed;
}

function parseSearchInputCore(trimmed) {

  // "Pikachu s10b 028/071" — card name + set code + number/total
  const nameSetNumber = trimmed.match(/^(.+?)\s+([A-Za-z][A-Za-z0-9]{0,5})\s+(\d{1,3})\/(\d{1,3})$/);
  if (nameSetNumber) {
    return {
      setCode: nameSetNumber[2],
      localId: nameSetNumber[3].padStart(3, '0'),
      cardNumberFull: `${nameSetNumber[3]}/${nameSetNumber[4]}`,
      cardName: nameSetNumber[1].trim(),
    };
  }

  // "Pikachu 028/071 s10b" — card name + number/total + set code
  const nameNumberSet = trimmed.match(/^(.+?)\s+(\d{1,3})\/(\d{1,3})\s+([A-Za-z][A-Za-z0-9]{0,5})$/);
  if (nameNumberSet) {
    return {
      setCode: nameNumberSet[4],
      localId: nameNumberSet[2].padStart(3, '0'),
      cardNumberFull: `${nameNumberSet[2]}/${nameNumberSet[3]}`,
      cardName: nameNumberSet[1].trim(),
    };
  }

  // "s10b 028/071" — set code (max 6 chars, no spaces) + number/total
  const setCodeAndFullNumber = trimmed.match(/^([A-Za-z][A-Za-z0-9]{0,5})\s+(\d{1,3})\/(\d{1,3})$/);
  if (setCodeAndFullNumber) {
    return {
      setCode: setCodeAndFullNumber[1],
      localId: setCodeAndFullNumber[2].padStart(3, '0'),
      cardNumberFull: `${setCodeAndFullNumber[2]}/${setCodeAndFullNumber[3]}`,
      cardName: null,
    };
  }

  // "Pikachu 028/071" — card name + number/total (name has space or > 6 chars)
  const nameAndNumber = trimmed.match(/^(.+?)\s+(\d{1,3})\/(\d{1,3})$/);
  if (nameAndNumber) {
    const name = nameAndNumber[1].trim();
    if (name.includes(' ') || name.length > 6) {
      return { setCode: null, localId: nameAndNumber[2].padStart(3, '0'), cardNumberFull: `${nameAndNumber[2]}/${nameAndNumber[3]}`, cardName: name };
    }
    return { setCode: name, localId: nameAndNumber[2].padStart(3, '0'), cardNumberFull: `${nameAndNumber[2]}/${nameAndNumber[3]}`, cardName: null };
  }

  // "M2a-017" or "M2a 017" — set code + local id
  const dashOrSpaceFormat = trimmed.match(/^([A-Za-z][A-Za-z0-9]{0,5})[\s-]+(\d{1,3})$/);
  if (dashOrSpaceFormat) {
    return { setCode: dashOrSpaceFormat[1], localId: dashOrSpaceFormat[2].padStart(3, '0'), cardNumberFull: null, cardName: null };
  }

  // "017/193 M2a" or "017/193" — number first, optional set code
  const numberFirstFormat = trimmed.match(/^(\d{1,3})\/(\d{1,3})\s*([A-Za-z][A-Za-z0-9]{0,5})?$/);
  if (numberFirstFormat) {
    return {
      setCode: numberFirstFormat[3] || null,
      localId: numberFirstFormat[1].padStart(3, '0'),
      cardNumberFull: `${numberFirstFormat[1]}/${numberFirstFormat[2]}`,
      cardName: null,
    };
  }

  return null;
}

async function onSearchSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('searchInput').value;
  const parsed = parseSearchInput(input);

  if (!parsed || (!parsed.setCode && !parsed.cardName)) {
    showStatus('Enter e.g. "M2a 017" or "Pikachu 028/071"', true);
    return;
  }

  const searchBtn = document.getElementById('searchBtn');
  searchBtn.disabled = true;
  searchBtn.textContent = '⏳';

  await chrome.storage.local.set({ manualSearchData: parsed });
  await chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') + '#manual' });
  window.close();
}

function showStatus(message, isError = false) {
  const el = document.getElementById('statusArea');
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('error', isError);
}

function showProgressSteps(stepStates) {
  const el = document.getElementById('statusArea');
  el.innerHTML = `<div class="progress-steps">${renderProgressSteps(stepStates)}</div>`;
  el.classList.remove('hidden');
  el.classList.remove('error');
}

function hideStatus() {
  document.getElementById('statusArea').classList.add('hidden');
}

// Re-runs a history entry in the scanner. The #manual flow is reused: the entry
// does not keep enough data for a full re-render here, but it does have the set
// code, number, name, and language the lookup needs.
async function openHistoryLookup(entry) {
  const cardNumber = entry.cardNumber || '';
  await chrome.storage.local.set({
    manualSearchData: {
      setCode: entry.setCode || '',
      localId: cardNumber.split('/')[0],
      cardNumberFull: cardNumber,
      cardName: entry.cardNameEn || entry.cardNameJp || '',
      language: entry.language || null,
    },
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL('scanner/scanner.html') + '#manual' });
  window.close();
}

async function renderHistory() {
  const history = await getScanHistory();
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  const section = document.querySelector('.history-section');

  list.innerHTML = '';

  const validEntries = history.filter((entry) => entry && entry.cardId && (entry.cardNameJp || entry.cardNameEn));

  // Clean up storage if invalid entries found
  if (validEntries.length !== history.length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SCAN_HISTORY]: validEntries });
  }

  if (validEntries.length === 0) {
    empty.classList.add('hidden');
    if (section) section.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  if (section) section.classList.remove('hidden');

  for (const entry of validEntries.slice(0, 10)) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const priceLabel = entry.price
      ? (entry.currency === 'USD' ? `$${entry.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : `¥${entry.price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`)
      : '';
    const nameLabel = entry.cardNameJp || entry.cardNameEn || '';
    const contentHtml = `
      <img src="${entry.imageUrl || ''}" alt="" />
      <span class="history-name">${nameLabel}</span>
      <span class="history-price">${priceLabel}</span>
    `;
    // Every entry has an action, so each renders as a real link or button:
    // keyboard focusable and activatable without extra ARIA roles. Entries with
    // a product page open it; the rest re-run the lookup in the scanner.
    const suffix = priceLabel ? `, ${priceLabel}` : '';
    let control;
    if (entry.cardrushUrl) {
      control = document.createElement('a');
      control.href = entry.cardrushUrl;
      control.target = '_blank';
      control.rel = 'noopener';
      control.setAttribute('aria-label', `${nameLabel}${suffix} - open on CardRush`);
    } else {
      control = document.createElement('button');
      control.type = 'button';
      control.setAttribute('aria-label', `${nameLabel}${suffix} - look up again`);
      control.addEventListener('click', () => openHistoryLookup(entry));
    }
    control.className = 'history-link';
    control.innerHTML = contentHtml;
    li.appendChild(control);
    list.appendChild(li);
  }
}
