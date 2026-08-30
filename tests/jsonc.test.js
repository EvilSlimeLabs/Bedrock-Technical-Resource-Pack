'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonc, normalizeJsonc } = require('../tools/lib/jsonc.js');

test('line comments are ignored, including after a value', () => {
  const doc = parseJsonc('{ "a": 1, // trailing\n "b": 2 } // end');
  assert.deepEqual(doc, { a: 1, b: 2 });
});

test('block comments are ignored', () => {
  const doc = parseJsonc('{ /* header */ "a": /* inline */ 1 }');
  assert.deepEqual(doc, { a: 1 });
});

test('a slash inside a string is not a comment', () => {
  const doc = parseJsonc('{ "path": "textures//odd", "molang": "a/*b*/c" }');
  assert.equal(doc.path, 'textures//odd');
  assert.equal(doc.molang, 'a/*b*/c');
});

test('an escaped quote does not end the string', () => {
  const doc = parseJsonc('{ "a": "he said \\"hi\\" // not a comment" }');
  assert.equal(doc.a, 'he said "hi" // not a comment');
});

test('trailing commas are tolerated in objects and arrays', () => {
  assert.deepEqual(parseJsonc('{ "a": [1, 2, ], }'), { a: [1, 2] });
});

test('a comma inside a string survives', () => {
  assert.deepEqual(parseJsonc('{ "a": "1, ]" }'), { a: '1, ]' });
});

test('raw tabs inside a string literal are accepted, as Bedrock accepts them', () => {
  // animations/chunk.json packs Molang statements apart with real tab
  // characters, which JSON.parse rejects outright.
  const doc = parseJsonc('{ "script": "v.x = 8;\tv.y = 8;" }');
  assert.equal(doc.script, 'v.x = 8;\tv.y = 8;');
});

test('a UTF-8 BOM is stripped', () => {
  assert.deepEqual(parseJsonc('﻿{ "a": 1 }'), { a: 1 });
});

test('parse errors point at the line and column in the original file', () => {
  const text = '{\n  // a comment\n  "a": 1\n  "b": 2\n}';
  assert.throws(
    () => parseJsonc(text, 'thing.json'),
    (err) => {
      assert.equal(err.label, 'thing.json');
      assert.equal(err.line, 4, `reported line ${err.line}: ${err.message}`);
      assert.match(err.message, /^thing\.json:4:/);
      return true;
    },
  );
});

test('normalising leaves valid JSON parseable and unchanged in meaning', () => {
  const original = { a: [1, 2, 3], b: { c: 'd' } };
  const { text } = normalizeJsonc(JSON.stringify(original));
  assert.deepEqual(JSON.parse(text), original);
});
