// Settings page logic: Gemini API key management, clear scan history,
// show extension version. Depends on constants.js and storage.js being
// loaded first via <script> tags.

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('versionLabel').textContent = chrome.runtime.getManifest().version;
  document.getElementById('clearHistoryBtn').addEventListener('click', onClearHistory);
  document.getElementById('clearTcgdexCacheBtn').addEventListener('click', onClearTcgdexCache);
  document.getElementById('saveApiKeyBtn').addEventListener('click', onSaveApiKey);
  document.getElementById('testApiKeyBtn').addEventListener('click', onTestApiKey);
  document.getElementById('clearApiKeyBtn').addEventListener('click', onClearApiKey);
  document.getElementById('toggleKeyVisibilityBtn').addEventListener('click', onToggleKeyVisibility);
  document.getElementById('openShortcutsLink').addEventListener('click', onOpenShortcuts);
  document.getElementById('imageQualitySelect').addEventListener('change', onImageQualityChange);
  document.getElementById('autoLookupInput').addEventListener('change', onAutoLookupChange);
  loadApiKeyIntoInput();
  loadHotkeyDisplay();
  loadImageQualitySetting();
  loadAutoLookupSetting();
});

async function loadApiKeyIntoInput() {
  const settings = await getSettings();
  const input = document.getElementById('geminiApiKeyInput');
  if (settings.geminiApiKey) {
    input.value = settings.geminiApiKey;
  }
}

async function onSaveApiKey() {
  const key = document.getElementById('geminiApiKeyInput').value.trim();
  const settings = await getSettings();
  settings.geminiApiKey = key || undefined;
  await saveSettings(settings);
  showApiKeyStatus(key ? 'API key saved.' : 'API key cleared.', false);
}

async function onTestApiKey() {
  const key = document.getElementById('geminiApiKeyInput').value.trim();
  if (!key) {
    showApiKeyStatus('Enter an API key first.', true);
    return;
  }

  showApiKeyStatus('Testing...', false);
  const url = `${GEMINI_API_URL}?key=${key}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      }),
    });
    if (response.ok) {
      showApiKeyStatus('API key works!', false);
    } else {
      const body = await response.text();
      showApiKeyStatus(`Failed (${response.status}): ${body.substring(0, 100)}`, true);
    }
  } catch (err) {
    showApiKeyStatus(`Network error: ${err.message}`, true);
  }
}

async function onClearApiKey() {
  const input = document.getElementById('geminiApiKeyInput');
  input.value = '';
  const settings = await getSettings();
  delete settings.geminiApiKey;
  await saveSettings(settings);
  showApiKeyStatus('API key cleared.', false);
}

function onToggleKeyVisibility() {
  const input = document.getElementById('geminiApiKeyInput');
  const btn = document.getElementById('toggleKeyVisibilityBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

function showApiKeyStatus(message, isError) {
  const status = document.getElementById('apiKeyStatus');
  status.textContent = message;
  status.classList.remove('hidden', 'error');
  if (isError) status.classList.add('error');
  if (!isError) setTimeout(() => status.classList.add('hidden'), 3000);
}

async function onClearHistory() {
  await clearScanHistory();
  const msg = document.getElementById('clearConfirmMsg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

async function onClearTcgdexCache() {
  await chrome.storage.local.remove(['setListCache', 'setAbbreviationMap', 'setCodeMappingCache']);
  const msg = document.getElementById('clearTcgdexCacheMsg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

async function loadImageQualitySetting() {
  const settings = await getSettings();
  const select = document.getElementById('imageQualitySelect');
  select.value = settings.imageQuality || 'medium';
}

async function onImageQualityChange() {
  const quality = document.getElementById('imageQualitySelect').value;
  const settings = await getSettings();
  settings.imageQuality = quality;
  await saveSettings(settings);
  const status = document.getElementById('imageQualityStatus');
  status.textContent = 'Saved.';
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 2000);
}

// On by default: an existing settings object has no `autoLookup` key, and the
// scanner treats only an explicit false as off.
async function loadAutoLookupSetting() {
  const settings = await getSettings();
  document.getElementById('autoLookupInput').checked = settings.autoLookup !== false;
}

async function onAutoLookupChange() {
  const settings = await getSettings();
  settings.autoLookup = document.getElementById('autoLookupInput').checked;
  await saveSettings(settings);
  const status = document.getElementById('autoLookupStatus');
  status.textContent = 'Saved.';
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 2000);
}

async function loadHotkeyDisplay() {
  try {
    const commands = await chrome.commands.getAll();
    const snapshotCmd = commands.find((c) => c.name === 'snapshot');
    const display = document.getElementById('hotkeyDisplay');
    if (snapshotCmd && snapshotCmd.shortcut) {
      display.textContent = snapshotCmd.shortcut;
    } else {
      display.textContent = 'Not set';
    }
  } catch (err) {
    console.error('[settings] failed to load hotkey:', err.message);
  }
}

function onOpenShortcuts(e) {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
