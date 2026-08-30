'use strict';

/**
 * A minimal, dependency-free ZIP writer.
 *
 * An `.mcpack` is an ordinary ZIP archive with a different extension, so this
 * is the whole of the "compiler" back end. It is written by hand rather than
 * shelled out to `zip`/`Compress-Archive` for three reasons the pack depends
 * on:
 *
 *  - entry paths are always forward-slash separated, whatever the host OS;
 *  - entry order and timestamps are fixed, so the same tree always produces a
 *    byte-identical archive;
 *  - nothing gets silently added (no `__MACOSX`, no directory entries with
 *    host-specific attributes).
 *
 * Only the classic 32-bit format is emitted. That is a hard ceiling of 4 GiB
 * per archive and 65535 entries, both far above anything a resource pack
 * reaches; `writeZip` throws rather than emitting a corrupt archive if either
 * is exceeded.
 */

const zlib = require('node:zlib');

/** Fixed MS-DOS timestamp (2020-01-01 00:00:00) so builds are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number} CRC-32 of `buf` as an unsigned 32-bit integer
 */
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Compress an entry, falling back to stored bytes whenever deflating fails to
 * make it smaller (which is the usual outcome for PNG).
 *
 * @param {Buffer} data
 * @returns {{method: number, body: Buffer}} method 8 = deflate, 0 = store
 */
function compress(data) {
  if (data.length === 0) return { method: 0, body: data };
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  if (deflated.length < data.length) return { method: 8, body: deflated };
  return { method: 0, body: data };
}

/**
 * Build a ZIP archive in memory.
 *
 * Entries are written in the order given; callers sort first so the archive is
 * stable. Duplicate paths are rejected because Bedrock resolves them
 * unpredictably.
 *
 * @param {Array<{path: string, data: Buffer}>} entries archive paths must use `/`
 * @returns {Buffer} the complete archive
 */
function writeZip(entries) {
  if (entries.length > 0xffff) {
    throw new Error(`zip: ${entries.length} entries exceeds the 65535 limit`);
  }

  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const path = entry.path;
    if (path.includes('\\')) {
      throw new Error(`zip: entry path must use forward slashes: ${path}`);
    }
    if (path.startsWith('/') || path.includes('..')) {
      throw new Error(`zip: entry path must be relative and contained: ${path}`);
    }
    if (seen.has(path.toLowerCase())) {
      throw new Error(`zip: duplicate entry path: ${path}`);
    }
    seen.add(path.toLowerCase());

    const name = Buffer.from(path, 'utf8');
    const utf8 = name.length !== path.length;
    const flags = utf8 ? 0x0800 : 0;
    const { method, body } = compress(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by (MS-DOS, 2.0)
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;

    if (offset > 0xffffffff) {
      throw new Error('zip: archive exceeds the 4 GiB limit of the 32-bit format');
    }
  }

  const centralStart = offset;
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, ...centrals, eocd]);
}

/**
 * Read an archive back out. Used by the tests to prove an archive round-trips;
 * the build itself never calls it.
 *
 * @param {Buffer} buf a complete archive produced by `writeZip`
 * @returns {Array<{path: string, data: Buffer}>} entries in central-directory order
 */
function readZip(buf) {
  let eocdAt = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) throw new Error('zip: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocdAt + 10);
  let at = buf.readUInt32LE(eocdAt + 16);
  const out = [];

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) {
      throw new Error('zip: bad central directory signature');
    }
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compSize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const path = buf.toString('utf8', at + 46, at + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localAt + 26);
    const localExtraLen = buf.readUInt16LE(localAt + 28);
    const bodyAt = localAt + 30 + localNameLen + localExtraLen;
    const body = buf.subarray(bodyAt, bodyAt + compSize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);

    if (crc32(data) !== crc) throw new Error(`zip: CRC mismatch for ${path}`);
    out.push({ path, data });
    at += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

module.exports = { writeZip, readZip, crc32 };
