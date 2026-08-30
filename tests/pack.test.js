'use strict';

/**
 * These run against the pack as it stands in the working tree — what ships, not
 * a fixture of it — so a content change that breaks a reference fails the suite
 * as well as the audit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPack, collectPackFiles, resolveTexture } = require('../tools/lib/pack.js');
const { validatePack, loadVanillaBaseline } = require('../tools/lib/validate.js');
const { writeZip, readZip } = require('../tools/lib/zip.js');
const { readPngHeader } = require('../tools/lib/png.js');
const { ROOT, currentVersion, packName } = require('../tools/lib/cli.js');

const index = loadPack(ROOT);
const version = currentVersion();

test('the shipped pack validates without errors', () => {
  const { errors } = validatePack(index, { version, packName: packName(version) });
  assert.deepEqual(errors.map((e) => `${e.file}: ${e.message}`), []);
});

test('the version is the same in package.json and manifest.json', () => {
  assert.equal(index.manifest.header.version.join('.'), version);
  assert.equal(index.manifest.header.name, packName(version));
  assert.ok(index.manifest.header.description.startsWith(`v${version} — `));
});

test('the archive puts manifest.json at its root', () => {
  const entries = readZip(writeZip(index.files.map((p) => ({ path: p, data: Buffer.from(p) }))));
  assert.ok(entries.some((e) => e.path === 'manifest.json'));
  assert.ok(
    !entries.some((e) => e.path.split('/').length > 1 && e.path.endsWith('/manifest.json')),
    'manifest.json must not be nested inside a folder',
  );
});

test('manifest.json and pack_icon.png are the first entries', () => {
  assert.deepEqual(index.files.slice(0, 2), ['manifest.json', 'pack_icon.png']);
});

test('development material is left out of the archive', () => {
  const { files } = collectPackFiles(ROOT);
  for (const unwanted of ['package.json', 'README.md', 'CLAUDE.md', 'LICENSE', 'clearPictureFixer.py']) {
    assert.ok(!files.includes(unwanted), `${unwanted} must not ship`);
  }
  assert.ok(!files.some((f) => f.startsWith('tools/')), 'tools/ must not ship');
  assert.ok(!files.some((f) => f.startsWith('tests/')), 'tests/ must not ship');
  assert.ok(!files.some((f) => f.startsWith('documentation pictures')), 'docs images must not ship');
  assert.ok(!files.some((f) => f.startsWith('.git')), 'git metadata must not ship');
});

test('the shipped pack icon is a 256x256 PNG', () => {
  // Microsoft documents 256x256 for the pack selection screens; the icon is
  // generated, so a different size means branding/make_icon.py drifted.
  const header = readPngHeader(path.join(ROOT, 'pack_icon.png'));
  assert.equal(header.valid, true);
  assert.deepEqual([header.width, header.height], [256, 256]);
});

test('every entry in the archive exists on disk and is a file', () => {
  for (const packPath of index.files) {
    assert.ok(fs.statSync(path.join(ROOT, packPath)).isFile(), `${packPath} is not a file`);
  }
});

test('the pack still ships the armor stand and player client entities', () => {
  const identifiers = index.entities.map((e) => e.description.identifier).sort();
  assert.deepEqual(identifiers, ['minecraft:armor_stand', 'minecraft:player']);
});

test('the vanilla baseline covers every client entity the pack replaces', () => {
  // Without a baseline entry, dropping a short name vanilla still asks for goes
  // unreported. `node tools/refresh-baseline.js` regenerates the file.
  const baseline = loadVanillaBaseline();
  for (const { description } of index.entities) {
    assert.ok(
      baseline.entities[description.identifier],
      `${description.identifier} has no entry in tools/vanilla-baseline.json`,
    );
  }
});

test('the player entity declares every animation short name vanilla does', () => {
  // Vanilla's player controllers play these by short name; a missing entry is a
  // "can't find animation <name>" in the content log every frame.
  const player = index.entities.find((e) => e.description.identifier === 'minecraft:player');
  const expected = loadVanillaBaseline().entities['minecraft:player'].animations;
  const missing = expected.filter((name) => !(name in player.description.animations));
  assert.deepEqual(missing, []);
});

test('every texture reference resolves to a file with the same letter case', () => {
  for (const { description } of index.entities) {
    for (const [short, ref] of Object.entries(description.textures ?? {})) {
      if (!ref.startsWith('textures/')) continue; // vanilla path
      const resolved = resolveTexture(index, ref);
      if (resolved === null) continue; // covered by the external allowlist
      assert.equal(resolved.slice(0, ref.length), ref, `${short} resolves to ${resolved}`);
    }
  }
});
