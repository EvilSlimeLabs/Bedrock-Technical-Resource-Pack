'use strict';

/**
 * `npm run build` — compile the pack to `dist/<name>-v<version>.mcpack`.
 *
 * An `.mcpack` is a ZIP whose *root* is the pack root: `manifest.json` must be
 * the first thing inside the archive, not inside a wrapper folder. Minecraft
 * imports an archive with a wrapper folder without an error and the pack simply
 * never appears in the list, so the archive is assembled from the pack index
 * rather than by zipping a directory.
 *
 * The build validates before it writes. It is the last gate before an artifact
 * exists, so a failing audit must not be able to produce one.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadPack } = require('./lib/pack.js');
const { validatePack } = require('./lib/validate.js');
const { writeZip } = require('./lib/zip.js');
const { ROOT, ARTIFACT_BASENAME, currentVersion, printFindings } = require('./lib/cli.js');

/**
 * Remove artifacts from previous versions so `dist/` holds one release, not a
 * pile of them.
 *
 * @param {string} distDir
 * @param {string} keep file name to leave alone
 */
function cleanDist(distDir, keep) {
  if (!fs.existsSync(distDir)) return;
  for (const entry of fs.readdirSync(distDir)) {
    if (entry === keep) continue;
    if (!/\.(mcpack|zip|mcaddon)$/i.test(entry)) continue;
    fs.rmSync(path.join(distDir, entry));
    console.log(`build: removed stale artifact dist/${entry}`);
  }
}

/**
 * @param {number} bytes
 * @returns {string} human-readable size
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function main() {
  const version = currentVersion();
  const index = loadPack(ROOT);
  const { errors, warnings } = validatePack(index, { version });

  if (warnings.length > 0) {
    console.log(`build: ${warnings.length} warning(s)`);
    printFindings('warning', warnings);
  }

  if (errors.length > 0) {
    console.error(`build: refusing to package, ${errors.length} error(s)`);
    printFindings('error', errors);
    process.exitCode = 1;
    return;
  }

  const entries = index.files.map((packPath) => ({
    path: packPath,
    data: fs.readFileSync(path.join(ROOT, packPath)),
  }));

  if (entries[0]?.path !== 'manifest.json' && !entries.some((e) => e.path === 'manifest.json')) {
    console.error('build: manifest.json is not at the archive root');
    process.exitCode = 1;
    return;
  }

  const archive = writeZip(entries);
  const distDir = path.join(ROOT, 'dist');
  const fileName = `${ARTIFACT_BASENAME}-v${version}.mcpack`;
  fs.mkdirSync(distDir, { recursive: true });
  cleanDist(distDir, fileName);
  fs.writeFileSync(path.join(distDir, fileName), archive);

  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
  console.log(`build: dist/${fileName}`);
  console.log(`build: ${entries.length} entries, ${formatSize(raw)} packed to ${formatSize(archive.length)}`);
  console.log(`build: sha256 ${sha}`);
}

main();
