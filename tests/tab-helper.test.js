import { describe, it, expect } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

// Load constants.js + tab-helper.js into global scope
loadExtensionScripts('lib/tab-helper.js');

describe('pickCaptureWindow', () => {
  it('prefers the focused window', () => {
    const windows = [
      { id: 1, width: 200, height: 150, focused: false },
      { id: 2, width: 1440, height: 900, focused: true },
      { id: 3, width: 800, height: 600, focused: false },
    ];
    expect(pickCaptureWindow(windows).id).toBe(2);
  });

  it('falls back to the widest normal window when nothing is focused', () => {
    const windows = [
      { id: 1, width: 200, height: 150, focused: false },
      { id: 2, width: 1440, height: 900, focused: false },
      { id: 3, width: 900, height: 700, focused: false },
    ];
    expect(pickCaptureWindow(windows).id).toBe(2);
  });

  it('ignores scraper-sized windows even when they are focused', () => {
    const windows = [
      { id: 1, width: 200, height: 150, focused: true },
      { id: 2, width: 1200, height: 800, focused: false },
    ];
    // A focused 200px window is still the user's smallest window, so it wins:
    // this documents that focus beats size.
    expect(pickCaptureWindow(windows).id).toBe(1);
  });

  it('falls back to the first window, then null', () => {
    expect(pickCaptureWindow([{ id: 1, width: 200, height: 150, focused: false }]).id).toBe(1);
    expect(pickCaptureWindow([])).toBeNull();
    expect(pickCaptureWindow(null)).toBeNull();
  });
});
