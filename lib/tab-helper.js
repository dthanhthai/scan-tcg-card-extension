// Shared helper: open a URL in a minimized window so SPAs render properly.
// Hidden tabs (active: false) don't render React/Next.js SPAs because
// document.visibilityState is 'hidden'. A minimized window has
// visibilityState 'visible' so SPAs render normally, but the user
// doesn't see a flashing tab.
//
// Returns { tabId, windowId } on success.
// Caller must close both the tab and the window when done.

// chrome.windows.getCurrent() returns the last focused window, which can be one
// of the hidden scraper windows created below. Capturing one of those would grab
// the wrong page, so prefer the focused window, then the widest normal one.
function pickCaptureWindow(windows) {
  const list = windows || [];
  return list.find((win) => win.focused)
    || list.filter((win) => (win.width || 0) > 400).sort((a, b) => (b.width || 0) - (a.width || 0))[0]
    || list[0]
    || null;
}

async function openMinimizedTab(url) {
  // Open as a small normal window (not minimized) so document.visibilityState
  // is 'visible' from the start — SPAs like TCGPlayer check this on init and
  // skip rendering if hidden. Small size to be less intrusive.
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    state: 'normal',
    width: 200,
    height: 150,
    focused: false,
  });
  const tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
  if (!tabId) {
    await chrome.windows.remove(win.id).catch(() => {});
    throw new Error('Failed to create minimized tab');
  }
  return { tabId, windowId: win.id };
}

/**
 * Restores a minimized window to a small visible state (not fullscreen)
 * so the user can interact with CF checkbox without it taking the whole screen.
 */
async function restoreWindowSmall(windowId) {
  await chrome.windows.update(windowId, {
    state: 'normal',
    focused: true,
    width: 600,
    height: 400,
    left: 100,
    top: 100,
  }).catch(() => {});
}

async function closeMinimizedTab(tabId, windowId) {
  if (windowId) {
    await chrome.windows.remove(windowId).catch(() => {});
  } else {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabLoadGeneric(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}
