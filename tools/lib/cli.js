'use strict';

/**
 * Small shared pieces for the `tools/` entry points: where the repository root
 * is, what the version is, and how findings are printed.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Repository root, which is also the pack root. */
const ROOT = path.resolve(__dirname, '..', '..');

/** Base name of the built artifact, before the version suffix. */
const ARTIFACT_BASENAME = 'Bedrock-Technical-Resource-Pack';

/**
 * Read `package.json`, the single source of truth for the version.
 *
 * @returns {{version: string, [key: string]: unknown}}
 */
function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

/**
 * The version the build is producing, validated to be a plain triple.
 *
 * @returns {string}
 */
function currentVersion() {
  const { version } = readPackageJson();
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error(`package.json version must be "major.minor.patch", found ${JSON.stringify(version)}`);
  }
  return version;
}

/**
 * Print findings grouped by file.
 *
 * @param {string} label heading, e.g. "error"
 * @param {Array<{file: string, message: string}>} findings
 */
function printFindings(label, findings) {
  if (findings.length === 0) return;
  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding.message);
  }
  for (const [file, messages] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const message of messages) console.log(`    ${label}: ${message}`);
  }
}

module.exports = { ROOT, ARTIFACT_BASENAME, readPackageJson, currentVersion, printFindings };
