'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { writeZip, readZip, crc32 } = require('../tools/lib/zip.js');

const entry = (path, text) => ({ path, data: Buffer.from(text) });

test('CRC-32 matches the known value for "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('entries round-trip through the archive unchanged', () => {
  const entries = [
    entry('manifest.json', '{"format_version":2}'),
    entry('textures/slime/(1) -640,-640 to -384,-384.png', 'x'.repeat(500)),
  ];
  const read = readZip(writeZip(entries));
  assert.deepEqual(
    read.map((e) => e.path),
    entries.map((e) => e.path),
  );
  assert.equal(read[0].data.toString(), entries[0].data.toString());
  assert.equal(read[1].data.toString(), entries[1].data.toString());
});

test('the same input always produces byte-identical output', () => {
  const build = () => writeZip([entry('a.json', '{"a":1}'), entry('b/c.json', '{"b":2}')]);
  assert.ok(build().equals(build()));
});

test('an archive begins with a local file header', () => {
  const archive = writeZip([entry('manifest.json', '{}')]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
});

test('incompressible data is stored rather than grown', () => {
  const noise = Buffer.from(zlib.deflateRawSync(Buffer.from('seed'.repeat(64)), { level: 9 }));
  const archive = writeZip([{ path: 'noise.bin', data: noise }]);
  const method = archive.readUInt16LE(8);
  const [entryBack] = readZip(archive);
  assert.equal(method, 0, 'expected the stored method for data deflate cannot shrink');
  assert.ok(entryBack.data.equals(noise));
});

test('empty files are handled', () => {
  const [back] = readZip(writeZip([{ path: 'empty.json', data: Buffer.alloc(0) }]));
  assert.equal(back.data.length, 0);
});

test('no directory entries are emitted', () => {
  const paths = readZip(writeZip([entry('a/b/c.json', '{}')])).map((e) => e.path);
  assert.deepEqual(paths, ['a/b/c.json']);
});

test('backslashes, absolute paths and traversal are refused', () => {
  assert.throws(() => writeZip([entry('a\\b.json', '{}')]), /forward slashes/);
  assert.throws(() => writeZip([entry('/a.json', '{}')]), /relative/);
  assert.throws(() => writeZip([entry('../a.json', '{}')]), /relative/);
});

test('duplicate paths are refused, case-insensitively', () => {
  assert.throws(() => writeZip([entry('a.json', '{}'), entry('A.json', '{}')]), /duplicate/);
});

test('non-ASCII names are flagged as UTF-8', () => {
  const archive = writeZip([entry('textures/café.png', 'x')]);
  assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800);
  assert.equal(readZip(archive)[0].path, 'textures/café.png');
});
