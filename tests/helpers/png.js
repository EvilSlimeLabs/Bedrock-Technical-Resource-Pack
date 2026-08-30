'use strict';

/**
 * A minimal PNG encoder for the fixtures.
 *
 * The validator reads image headers off disk, so the tests hand it real PNGs
 * rather than stubs — otherwise a fixture could pass a check that a genuine
 * file would fail. Solid colour, truecolour, no interlacing: enough to be a
 * valid image at any size the tests need.
 */

const zlib = require('node:zlib');
const { crc32 } = require('../../tools/lib/zip.js');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Wrap data as a PNG chunk: length, type, data, CRC of type+data.
 *
 * @param {string} type four-character chunk name
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encode a solid-colour PNG.
 *
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} [rgb]
 * @returns {Buffer} a complete PNG file
 */
function makePng(width, height, rgb = [64, 64, 64]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = none) in front of each row of RGB triples.
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { makePng };
