// Packages the artifacts attached to a GitHub Release:
//   - the unpacked extension as one zip, which serves Chrome's "Load unpacked"
//     and Safari's "Add Temporary Extension" alike (scripts/build-extension.mjs
//     writes identical contents for both browsers);
//   - the packaged macOS app for Safari users who have no Xcode.
//
// The zips are written to build/release/ (gitignored), so binaries never enter
// git history. Attach the printed files to the release on GitHub.
//
// Usage: node scripts/package-release.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIRECTORY = join(PROJECT_ROOT, 'build', 'release');
const EXTENSION_OUTPUT = join(RELEASE_DIRECTORY, 'extension');
const SAFARI_APP = join(PROJECT_ROOT, 'build', 'safari', 'PokemonTcgScanner.app');
const BUILD_EXTENSION_SCRIPT = join(PROJECT_ROOT, 'scripts', 'build-extension.mjs');

/** Reads the version from manifest.json so artifact names match the release tag. */
function readExtensionVersion() {
  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, 'manifest.json'), 'utf8'));
  return manifest.version;
}

/** Writes the runtime entries to build/release/extension using the shared build script. */
function buildExtensionFolder() {
  execFileSync('node', [BUILD_EXTENSION_SCRIPT, '--out', EXTENSION_OUTPUT], { stdio: 'inherit' });
}

/** Zips the extension with its files at the archive root, so unzipping yields a loadable folder. */
function zipExtension(version) {
  const zipPath = join(RELEASE_DIRECTORY, `pokemon-tcg-scanner-extension-${version}.zip`);
  // -X drops the extra uid/gid attributes, which would otherwise differ per machine.
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: EXTENSION_OUTPUT });
  return zipPath;
}

/** Zips the .app with ditto, which keeps the bundle layout and symlinks that plain zip breaks. */
function zipSafariApp(version) {
  if (!existsSync(SAFARI_APP)) return null;
  const zipPath = join(RELEASE_DIRECTORY, `PokemonTcgScanner-${version}.app.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', SAFARI_APP, zipPath]);
  return zipPath;
}

/** Prints an artifact's path and size so it can be dragged into the release form. */
function reportArtifact(label, artifactPath) {
  const megabytes = (statSync(artifactPath).size / 1024 / 1024).toFixed(1);
  console.log(`${label}: ${artifactPath} (${megabytes} MB)`);
}

function main() {
  const version = readExtensionVersion();
  rmSync(RELEASE_DIRECTORY, { recursive: true, force: true });
  mkdirSync(RELEASE_DIRECTORY, { recursive: true });
  buildExtensionFolder();
  reportArtifact('Extension zip', zipExtension(version));
  const safariAppZip = zipSafariApp(version);
  if (!safariAppZip) {
    console.log('Safari app zip: skipped — build/safari/PokemonTcgScanner.app is missing.');
    console.log('Run ./safari/build-safari.sh first, then package again.');
    return;
  }
  reportArtifact('Safari app zip', safariAppZip);
  console.log('\nAttach both files to the GitHub Release.');
}

main();
