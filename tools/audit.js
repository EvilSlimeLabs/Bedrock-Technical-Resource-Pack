'use strict';

/**
 * `npm run audit` — resolve every reference in the pack.
 *
 * Bedrock fails silently on a broken reference: the geometry, texture or
 * controller simply does not draw. This is the step that turns those into
 * messages. Errors fail the run; warnings are printed and do not.
 *
 * `--quiet` suppresses warnings, for when only the pass/fail matters.
 */

const { loadPack } = require('./lib/pack.js');
const { validatePack } = require('./lib/validate.js');
const { ROOT, currentVersion, printFindings } = require('./lib/cli.js');

function main() {
  const quiet = process.argv.includes('--quiet');
  const version = currentVersion();
  const index = loadPack(ROOT);
  const { errors, warnings } = validatePack(index, { version });

  const counts = [
    `${index.files.length} files`,
    `${index.entities.length} entities`,
    `${index.geometries.size} geometries`,
    `${index.animations.size} animations`,
    `${index.animationControllers.size} animation controllers`,
    `${index.renderControllers.size} render controllers`,
    `${index.particles.size} particles`,
    `${index.materials.size} materials`,
    `${index.textures.size} textures`,
  ];
  console.log(`audit: v${version} — ${counts.join(', ')}`);

  if (!quiet && warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    printFindings('warning', warnings);
  }

  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`);
    printFindings('error', errors);
    console.log('\naudit: failed');
    process.exitCode = 1;
    return;
  }

  console.log(`\naudit: passed${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ''}`);
}

main();
