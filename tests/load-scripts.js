// Helper to load extension script files (which use top-level `const`
// declarations and expect globals from previously-loaded scripts) into
// the Node global scope, mimicking how importScripts / <script> tags work.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * Loads a script file into the global lexical scope by evaluating its source
 * with vm.runInThisContext. Top-level `const` declarations become accessible
 * as global lexical bindings to subsequently loaded scripts and test code.
 * @param {string} relativePath - path relative to project root
 */
export function loadScript(relativePath) {
  const fullPath = join(projectRoot, relativePath);
  const source = readFileSync(fullPath, 'utf-8');
  vm.runInThisContext(source, { filename: fullPath });
}

/**
 * Loads constants.js, then the given script files, in order.
 * @param {...string} scripts - relative paths to load after constants
 */
export function loadExtensionScripts(...scripts) {
  loadScript('utils/constants.js');
  for (const s of scripts) {
    loadScript(s);
  }
}
