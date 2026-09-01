'use strict';

/**
 * `npm run set-version -- <major|minor|fix|x.y.z>` — move the version in every
 * place it is written.
 *
 * CLAUDE.md requires the version to appear, consistently, in `package.json`,
 * `manifest.json`'s `header.version`, and the leading `v<version> — ` of the
 * pack description. `npm run audit` fails when they disagree; this is the tool
 * that keeps them together. The pack's `header.name` is not touched.
 *
 * The bump words follow CLAUDE.md: `major` resets minor and fix, `minor` resets
 * fix, `fix` touches only the last digit.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readPackageJson } = require('./lib/cli.js');

/**
 * @param {string} current dotted version
 * @param {string} arg a bump word or an explicit version
 * @returns {string} the new dotted version
 */
function nextVersion(current, arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [major, minor, fix] = current.split('.').map(Number);
  if (arg === 'major') return `${major + 1}.0.0`;
  if (arg === 'minor') return `${major}.${minor + 1}.0`;
  if (arg === 'fix' || arg === 'patch') return `${major}.${minor}.${fix + 1}`;
  throw new Error(`expected major, minor, fix, or an explicit x.y.z version; got "${arg}"`);
}

/**
 * Replace the `v<version> — ` prefix a pack description must lead with.
 *
 * @param {string} description
 * @param {string} version
 * @returns {string}
 */
function reprefix(description, version) {
  const body = description.replace(/^v\d+\.\d+\.\d+ — /, '');
  return `v${version} — ${body}`;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npm run set-version -- <major|minor|fix|x.y.z>');
    process.exitCode = 1;
    return;
  }

  const pkg = readPackageJson();
  const previous = pkg.version;
  const version = nextVersion(previous, arg);
  const triple = version.split('.').map(Number);

  pkg.version = version;
  fs.writeFileSync(path.join(ROOT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.header.version = triple;
  // header.name is the pack's name, not a version string; it is left alone.
  manifest.header.description = reprefix(manifest.header.description, version);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`set-version: ${previous} -> ${version}`);
  console.log(`set-version: manifest.json header.description now leads with "v${version} — "`);
}

main();
