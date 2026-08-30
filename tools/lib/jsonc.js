'use strict';

/**
 * Minecraft's JSON loader is more permissive than `JSON.parse`, and this pack
 * relies on all of it: `//` comments after array entries, a trailing comma here
 * and there, raw tab characters inside Molang string literals, and a UTF-8 BOM
 * on files that have been through a Windows editor. Every tool in `tools/`
 * reads pack files through here, so what the validator sees is what the game
 * sees.
 *
 * Normalising changes offsets, so the scanner carries a map from each character
 * of the normalised text back to its index in the original. A parse error is
 * therefore still reported at the line and column the author would find it at.
 */

/** JSON escapes for the control characters Bedrock tolerates unescaped. */
const CONTROL_ESCAPES = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };

/**
 * Strip comments and escape raw control characters, remembering where every
 * surviving character came from.
 *
 * @param {string} text source text, BOM already removed
 * @returns {{text: string, map: number[]}} normalised text and its index map
 */
function scan(text) {
  const out = [];
  const map = [];
  const n = text.length;
  let i = 0;

  const push = (ch, at) => {
    out.push(ch);
    map.push(at);
  };

  while (i < n) {
    const c = text[i];

    if (c === '"') {
      push('"', i);
      i += 1;
      while (i < n) {
        const s = text[i];
        if (s === '\\') {
          push(s, i);
          if (i + 1 < n) push(text[i + 1], i + 1);
          i += 2;
          continue;
        }
        if (s === '"') {
          push('"', i);
          i += 1;
          break;
        }
        const code = s.charCodeAt(0);
        if (code < 0x20) {
          const escape = CONTROL_ESCAPES[code] ?? `\\u${code.toString(16).padStart(4, '0')}`;
          for (const ch of escape) push(ch, i);
          i += 1;
          continue;
        }
        push(s, i);
        i += 1;
      }
      continue;
    }

    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    push(c, i);
    i += 1;
  }

  return { chars: out, map };
}

/**
 * Drop commas that sit directly before a `}` or `]`.
 *
 * Runs over the comment-free output of `scan`, so the only thing that can hide
 * between a comma and its closing brace is whitespace.
 *
 * @param {{chars: string[], map: number[]}} scanned
 * @returns {{text: string, map: number[]}}
 */
function dropTrailingCommas(scanned) {
  const { chars, map } = scanned;
  const keep = new Array(chars.length).fill(true);
  const n = chars.length;
  let i = 0;

  while (i < n) {
    const c = chars[i];
    if (c === '"') {
      i += 1;
      while (i < n) {
        if (chars[i] === '\\') {
          i += 2;
          continue;
        }
        const closing = chars[i] === '"';
        i += 1;
        if (closing) break;
      }
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(chars[j])) j += 1;
      if (chars[j] === '}' || chars[j] === ']') keep[i] = false;
    }
    i += 1;
  }

  const outChars = [];
  const outMap = [];
  for (let k = 0; k < n; k += 1) {
    if (!keep[k]) continue;
    outChars.push(chars[k]);
    outMap.push(map[k]);
  }
  return { text: outChars.join(''), map: outMap };
}

/**
 * Normalise a Minecraft-flavoured JSON document into something `JSON.parse`
 * accepts.
 *
 * @param {string} text raw file contents, BOM allowed
 * @returns {{text: string, map: number[], source: string}}
 */
function normalizeJsonc(text) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const { text: normalized, map } = dropTrailingCommas(scan(source));
  return { text: normalized, map, source };
}

/**
 * Convert a character offset into a 1-based `line:column` pair.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{line: number, column: number}}
 */
function positionAt(text, offset) {
  const upto = text.slice(0, Math.max(0, offset));
  const line = upto.split('\n').length;
  const column = offset - (upto.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

/**
 * Parse a Minecraft-flavoured JSON document.
 *
 * @param {string} text raw file contents
 * @param {string} [label] file path used in the error message
 * @returns {any} parsed value
 * @throws {Error} with `label`, `line` and `column` attached, pointing into the
 *   original file rather than the normalised copy
 */
function parseJsonc(text, label = '<input>') {
  const { text: normalized, map, source } = normalizeJsonc(text);

  try {
    return JSON.parse(normalized);
  } catch (err) {
    const match = /position (\d+)/.exec(err.message);
    const at = match ? Number(match[1]) : 0;
    const sourceAt = map[Math.min(at, map.length - 1)] ?? 0;
    const { line, column } = positionAt(source, sourceAt);
    const wrapped = new Error(`${label}:${line}:${column} ${err.message}`);
    wrapped.label = label;
    wrapped.line = line;
    wrapped.column = column;
    throw wrapped;
  }
}

module.exports = { parseJsonc, normalizeJsonc, positionAt };
