'use strict';

/**
 * `npm run check` — parse every document the game will parse.
 *
 * This is the fast gate: it says nothing about whether references resolve, only
 * that every JSON and `.material` file in the pack is syntactically loadable.
 * A file that fails here is skipped entirely by Bedrock, so nothing in it works
 * and nothing says why.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseJsonc } = require('./lib/jsonc.js');
const { collectPackFiles } = require('./lib/pack.js');
const { ROOT } = require('./lib/cli.js');

/** Tooling documents that are not pack content but must still parse. */
const TOOL_FILES = ['package.json', 'tools/external-refs.json'];

function main() {
  const { files } = collectPackFiles(ROOT);
  const targets = [
    ...files.filter((f) => /\.(json|material)$/i.test(f)),
    ...TOOL_FILES.filter((f) => fs.existsSync(path.join(ROOT, f))),
  ];

  const failures = [];
  for (const packPath of targets) {
    try {
      parseJsonc(fs.readFileSync(path.join(ROOT, packPath), 'utf8'), packPath);
    } catch (err) {
      failures.push(err.message);
    }
  }

  if (failures.length > 0) {
    console.error(`check: ${failures.length} file(s) failed to parse`);
    for (const message of failures) console.error(`  ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`check: ${targets.length} documents parsed`);
}

main();
