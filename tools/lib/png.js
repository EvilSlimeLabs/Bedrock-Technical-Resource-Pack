'use strict';

/**
 * Just enough PNG to answer "is this really a PNG, and how big is it?".
 *
 * The toolchain has no dependencies, so there is no image library to ask. There
 * does not need to be: a PNG's dimensions live in the IHDR chunk, which the
 * format requires to be the first chunk, so the answer is always in the first
 * 24 bytes of the file.
 */

const fs = require('node:fs');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Signature (8) + chunk length (4) + chunk type (4) + width (4) + height (4). */
const HEADER_BYTES = 24;

/**
 * Read a PNG's signature and dimensions.
 *
 * @param {string} file absolute path
 * @returns {{valid: boolean, width: number|null, height: number|null}}
 *   `valid` is false when the file is not a PNG at all; dimensions are null
 *   unless an IHDR chunk was found where the format requires it.
 */
function readPngHeader(file) {
  const head = Buffer.alloc(HEADER_BYTES);
  const handle = fs.openSync(file, 'r');
  let read = 0;
  try {
    read = fs.readSync(handle, head, 0, HEADER_BYTES, 0);
  } finally {
    fs.closeSync(handle);
  }

  if (read < SIGNATURE.length || !head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    return { valid: false, width: null, height: null };
  }
  if (read < HEADER_BYTES || head.toString('latin1', 12, 16) !== 'IHDR') {
    return { valid: true, width: null, height: null };
  }

  return { valid: true, width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

module.exports = { readPngHeader, SIGNATURE };
