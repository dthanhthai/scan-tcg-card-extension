// Lightweight Chrome extension API stubs for Vitest.
// Provides in-memory implementations of chrome.storage.local and
// chrome.runtime.sendMessage so that extension code can run under Node.

const storage = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return { ...storage };
        if (typeof keys === 'string') {
          return keys in storage ? { [keys]: storage[keys] } : {};
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) {
            if (k in storage) result[k] = storage[k];
          }
          return result;
        }
        // Object with defaults
        const result = {};
        for (const [k, defaultValue] of Object.entries(keys)) {
          result[k] = k in storage ? storage[k] : defaultValue;
        }
        return result;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) {
          storage[k] = v;
        }
      },
      async remove(keys) {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete storage[k];
      },
      async clear() {
        for (const k of Object.keys(storage)) delete storage[k];
      },
    },
  },
  runtime: {
    _messageHandler: null,
    onMessage: {
      addListener(handler) {
        globalThis.chrome.runtime._messageHandler = handler;
      },
      removeListener() {
        globalThis.chrome.runtime._messageHandler = null;
      },
    },
    async sendMessage(message) {
      // Default: no handler → return failure
      return { success: false, error: 'No message handler registered' };
    },
    getURL(path) {
      return `chrome-extension://test-id/${path}`;
    },
  },
  tabs: {
    async create() {
      return { id: 1 };
    },
    async captureVisibleTab() {
      return null;
    },
  },
  windows: {
    async getCurrent() {
      return { id: 1 };
    },
  },
  commands: {
    onCommand: {
      addListener() {},
      removeListener() {},
    },
  },
  scripting: {
    async executeScript() {
      return [];
    },
  },
};

// Helper to reset storage between tests
export function resetChromeStorage() {
  for (const k of Object.keys(storage)) delete storage[k];
}

// Helper to register a message handler (simulates service worker)
export function setMessageHandler(handler) {
  globalThis.chrome.runtime.sendMessage = async (message) => {
    return new Promise((resolve) => {
      const sendResponse = (response) => resolve(response);
      const result = handler(message, {}, sendResponse);
      if (result && typeof result.then === 'function') {
        result.then(sendResponse).catch((err) =>
          sendResponse({ success: false, error: err.message }),
        );
      }
    });
  };
}
