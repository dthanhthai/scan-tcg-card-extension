// Builds a loadable extension folder: either the Chrome "Load unpacked" folder
// or the folder Safari's Develop > Add Temporary Extension picker expects.
//
// The repository root also holds tests, dev scripts, docs, the Safari Xcode
// project, and the Bulbapedia review reports — none of which belong in the
// extension package. This copies only the entries the extension loads at
// runtime (the same set the Safari Xcode project bundles) and strips the
// development-only files under data/.
//
// Usage: node scripts/build-extension.mjs [--out <directory>]
//   --out defaults to build/chrome
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(PROJECT_ROOT, 'data');

const RUNTIME_ENTRIES = [
  'manifest.json',
  'assets',
  'background',
  'content-scripts',
  'data',
  'lib',
  'popup',
  'scanner',
  'settings',
  'utils',
  'vendor',
];

// The extension loads only the .js bundles from data/ (counterpart-index.js and
// set-era-map.js); the JSON reports and gold-pair text files next to them are
// review artifacts worth about 29 MB.
function shouldCopyFile(source) {
  return source.startsWith(DATA_DIR) ? source.endsWith('.js') : true;
}

function copyTree(source, destination, stats) {
  if (statSync(source).isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(destination, entry), stats);
    }
    return;
  }
  if (!shouldCopyFile(source)) return;
  copyFileSync(source, destination);
  stats.files += 1;
  stats.bytes += statSync(source).size;
}

function parseOutputDirectory() {
  const index = process.argv.indexOf('--out');
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value) return join(PROJECT_ROOT, 'build', 'chrome');
  return isAbsolute(value) ? value : resolve(PROJECT_ROOT, value);
}

function main() {
  const outputDirectory = parseOutputDirectory();
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const stats = { files: 0, bytes: 0 };
  for (const entry of RUNTIME_ENTRIES) {
    copyTree(join(PROJECT_ROOT, entry), join(outputDirectory, entry), stats);
  }
  const megabytes = (stats.bytes / 1024 / 1024).toFixed(1);
  console.log(`Built extension folder: ${outputDirectory} (${stats.files} files, ${megabytes} MB)`);
}

main();
