'use strict';

/**
 * Reads the pack off disk and builds an index of everything it defines.
 *
 * The index is the input to both `tools/audit.js` and `tools/build.js`: the
 * audit resolves references against it, the build turns the same file list into
 * the `.mcpack`. Keeping one collector means the archive can never contain a
 * file the audit did not look at, or miss one it did.
 *
 * Paths are stored as "pack paths" — forward-slash separated, relative to the
 * pack root, in the exact case the file has on disk. Bedrock is case-sensitive
 * on Android, iOS and consoles even though Windows is not, so matching a
 * reference against these strings catches casing bugs that would only show up
 * on someone else's device.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseJsonc } = require('./jsonc.js');

/**
 * Top-level entries that are part of the pack and therefore go into the
 * archive. Everything else in the repository — tooling, docs, CI, the git
 * metadata — is development material and is left out.
 *
 * This is an allowlist on purpose: a new folder is excluded until someone adds
 * it here, which fails loudly at build time rather than silently shipping
 * whatever happened to be lying in the working tree.
 */
const PACK_ROOTS = [
  'manifest.json',
  'pack_icon.png',
  'animation_controllers',
  'animations',
  'attachables',
  'entity',
  'fogs',
  'font',
  'materials',
  'models',
  'particles',
  'render_controllers',
  'sounds',
  'subpacks',
  'texts',
  'textures',
  'ui',
  'biomes_client.json',
  'blocks.json',
  'flipbook_textures.json',
  'item_texture.json',
  'sounds.json',
  'terrain_texture.json',
];

/** Extensions Bedrock will load as a texture, in resolution order. */
const TEXTURE_EXTENSIONS = ['.png', '.tga', '.jpg', '.jpeg'];

/** Files that never belong in a shipped pack even inside a pack root. */
const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Documents parsed as JSON regardless of extension. */
const JSON_EXTENSIONS = new Set(['.json', '.material']);

/**
 * Walk a directory, returning pack paths in on-disk case.
 *
 * @param {string} root pack root directory
 * @param {string} rel directory to walk, relative to root
 * @returns {string[]} pack paths of every file found, unsorted
 */
function walk(root, rel) {
  const abs = path.join(root, rel);
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(root, childRel));
    } else if (entry.isFile()) {
      if (JUNK.has(entry.name.toLowerCase())) continue;
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Collect every file that ships, in a stable order.
 *
 * @param {string} root pack root directory
 * @returns {{files: string[], missingRoots: string[]}} `files` are pack paths
 */
function collectPackFiles(root) {
  const files = [];
  const missingRoots = [];

  for (const entry of PACK_ROOTS) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) {
      if (entry === 'manifest.json' || entry === 'pack_icon.png') missingRoots.push(entry);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) files.push(...walk(root, entry));
    else files.push(entry);
  }

  // Alphabetical for a reproducible archive, but with the two files an
  // importer looks for first physically first in it.
  const FIRST = ['manifest.json', 'pack_icon.png'];
  files.sort((a, b) => {
    const rank = (f) => (FIRST.indexOf(f) === -1 ? FIRST.length : FIRST.indexOf(f));
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
  return { files, missingRoots };
}

/**
 * Record an identifier, remembering the second definition site so the audit can
 * report duplicates rather than silently keeping the last one.
 *
 * @param {Map<string, string>} map identifier to defining pack path
 * @param {Array<{kind: string, id: string, paths: string[]}>} duplicates
 * @param {string} kind index name, used in messages
 * @param {string} id identifier being defined
 * @param {string} packPath file defining it
 */
function define(map, duplicates, kind, id, packPath) {
  if (map.has(id)) {
    duplicates.push({ kind, id, paths: [map.get(id), packPath] });
    return;
  }
  map.set(id, packPath);
}

/**
 * Index the identifiers a single document defines.
 *
 * Which identifiers a file can define is decided by the folder it lives in,
 * exactly as the game decides it — a geometry in `animations/` is not loaded as
 * a geometry, so it is not indexed as one either.
 *
 * @param {object} index the pack index being filled in
 * @param {string} packPath file being indexed
 * @param {any} doc parsed document
 */
function indexDocument(index, packPath, doc) {
  if (!doc || typeof doc !== 'object') return;
  const dup = index.duplicates;
  const top = packPath.split('/')[0];

  if (top === 'models') {
    const geo = doc['minecraft:geometry'];
    if (Array.isArray(geo)) {
      // 1.12+ format: a list of models, each naming itself in `description`.
      for (const model of geo) {
        const id = model?.description?.identifier;
        if (typeof id === 'string') define(index.geometries, dup, 'geometry', id, packPath);
      }
    }
    // 1.8 format: top-level `geometry.name` or `geometry.name:parent` keys.
    for (const key of Object.keys(doc)) {
      if (!key.startsWith('geometry.')) continue;
      define(index.geometries, dup, 'geometry', key.split(':')[0], packPath);
    }
    return;
  }

  if (top === 'animations' && doc.animations && typeof doc.animations === 'object') {
    for (const id of Object.keys(doc.animations)) {
      define(index.animations, dup, 'animation', id, packPath);
    }
    return;
  }

  if (top === 'animation_controllers' && typeof doc.animation_controllers === 'object') {
    for (const id of Object.keys(doc.animation_controllers)) {
      define(index.animationControllers, dup, 'animation controller', id, packPath);
    }
    return;
  }

  if (top === 'render_controllers' && typeof doc.render_controllers === 'object') {
    for (const [id, body] of Object.entries(doc.render_controllers)) {
      define(index.renderControllers, dup, 'render controller', id, packPath);
      index.renderControllerBodies.set(id, { packPath, body });
    }
    return;
  }

  if (top === 'particles') {
    const desc = doc.particle_effect?.description;
    if (desc && typeof desc.identifier === 'string') {
      define(index.particles, dup, 'particle', desc.identifier, packPath);
      index.particleBodies.set(desc.identifier, { packPath, doc });
    }
    return;
  }

  if (top === 'materials' && doc.materials && typeof doc.materials === 'object') {
    for (const key of Object.keys(doc.materials)) {
      if (key === 'version') continue;
      // `name:parent` declares `name`, inheriting from `parent`.
      const [name, parent] = key.split(':');
      define(index.materials, dup, 'material', name, packPath);
      if (parent) index.materialParents.set(name, parent);
    }
    return;
  }

  if (top === 'entity') {
    const desc = doc['minecraft:client_entity']?.description;
    if (desc) index.entities.push({ packPath, description: desc });
  }
}

/**
 * Load and index the pack.
 *
 * Parse failures are collected rather than thrown so that one broken file does
 * not hide the rest of the report; callers decide whether to continue.
 *
 * @param {string} root pack root directory (defaults to the repository root)
 * @returns {object} the pack index
 */
function loadPack(root = path.resolve(__dirname, '..', '..')) {
  const { files, missingRoots } = collectPackFiles(root);

  const index = {
    root,
    files,
    missingRoots,
    parseErrors: [],
    duplicates: [],
    documents: new Map(),
    geometries: new Map(),
    animations: new Map(),
    animationControllers: new Map(),
    renderControllers: new Map(),
    renderControllerBodies: new Map(),
    particles: new Map(),
    particleBodies: new Map(),
    materials: new Map(),
    materialParents: new Map(),
    entities: [],
    /** texture pack path without extension -> pack path with extension */
    textures: new Map(),
    manifest: null,
  };

  for (const packPath of files) {
    const ext = path.extname(packPath).toLowerCase();

    if (TEXTURE_EXTENSIONS.includes(ext) && packPath.startsWith('textures/')) {
      index.textures.set(packPath.slice(0, -ext.length), packPath);
    }

    if (!JSON_EXTENSIONS.has(ext)) continue;

    const abs = path.join(root, packPath);
    let doc;
    try {
      doc = parseJsonc(fs.readFileSync(abs, 'utf8'), packPath);
    } catch (err) {
      index.parseErrors.push({ packPath, message: err.message });
      continue;
    }
    index.documents.set(packPath, doc);
    if (packPath === 'manifest.json') index.manifest = doc;
    else indexDocument(index, packPath, doc);
  }

  return index;
}

/**
 * Resolve an entity texture reference (which carries no extension) to the file
 * that satisfies it.
 *
 * @param {object} index pack index
 * @param {string} ref reference such as `textures/density`
 * @returns {string|null} the pack path of the texture file, or null
 */
function resolveTexture(index, ref) {
  const trimmed = ref.replace(/\.(png|tga|jpe?g)$/i, '');
  return index.textures.get(trimmed) ?? null;
}

module.exports = {
  PACK_ROOTS,
  TEXTURE_EXTENSIONS,
  collectPackFiles,
  loadPack,
  resolveTexture,
};
