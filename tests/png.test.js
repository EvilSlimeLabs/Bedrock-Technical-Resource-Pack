'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readPngHeader } = require('../tools/lib/png.js');
const { makePng } = require('./helpers/png.js');
const { GENERATED } = require('./helpers/fixture.js');

const DIR = path.join(GENERATED, 'png');

/**
 * @param {string} name
 * @param {Buffer} data
 * @returns {string} path to the written file
 */
function write(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  fs.writeFileSync(file, data);
  return file;
}

test('dimensions come back off a real PNG', () => {
  const header = readPngHeader(write('sized.png', makePng(256, 128)));
  assert.deepEqual([header.valid, header.width, header.height], [true, 256, 128]);
});

test('a file that is not a PNG is reported as invalid', () => {
  const header = readPngHeader(write('fake.png', Buffer.from('GIF89a and then some')));
  assert.deepEqual(header, { valid: false, width: null, height: null });
});

test('an empty file is reported as invalid', () => {
  const header = readPngHeader(write('empty.png', Buffer.alloc(0)));
  assert.equal(header.valid, false);
});

test('a PNG signature with no IHDR yields no dimensions', () => {
  const truncated = makePng(16, 16).subarray(0, 8);
  const header = readPngHeader(write('headless.png', truncated));
  assert.deepEqual(header, { valid: true, width: null, height: null });
});

test('the encoder the fixtures use produces a PNG the reader accepts', () => {
  for (const [w, h] of [[1, 1], [16, 16], [64, 48], [256, 256]]) {
    const header = readPngHeader(write(`round-${w}x${h}.png`, makePng(w, h)));
    assert.deepEqual([header.width, header.height], [w, h]);
  }
});
