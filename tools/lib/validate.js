'use strict';

/**
 * Every check that stands between the working tree and a shipped `.mcpack`.
 *
 * The rule the checks are built around: Bedrock does not report broken
 * references. A geometry that does not exist, a texture with the wrong case, a
 * render controller naming a short name the entity never declared — all of
 * these load without complaint and simply draw nothing. The only way to find
 * them is to resolve every reference here, before the archive is written.
 *
 * Findings are split in two:
 *
 *  - **errors** stop the build. Something is broken, or the pack would ship
 *    wrong: an unresolvable reference, a duplicate identifier, a manifest that
 *    disagrees with `package.json`.
 *  - **warnings** are reported and do not stop the build. Something is
 *    suspicious but legal: an asset nothing references, a file in the tree that
 *    will not be shipped.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseJsonc } = require('./jsonc.js');
const { PACK_ROOTS, resolveTexture } = require('./pack.js');
const { readPngHeader } = require('./png.js');

/** Top-level entries that are development material and are not shipped. */
const DEV_ENTRIES = new Set([
  '.claude',
  '.git',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.vscode',
  'branding',
  'claude.md',
  'clearpicturefixer.py',
  'dist',
  'documentation pictures',
  'license',
  'next_update.md',
  'node_modules',
  'package-lock.json',
  'package.json',
  'readme.md',
  'tests',
  'tools',
]);

/** Module types a resource pack may declare. */
const RESOURCE_MODULE_TYPES = new Set(['resources', 'skin_pack', 'world_template']);

/** Module types that would make this a behaviour pack. See CLAUDE.md. */
const BEHAVIOUR_MODULE_TYPES = new Set(['data', 'script', 'client_data', 'interface', 'javascript']);

/** Edge length Microsoft documents for a pack icon (CPACKICON104). */
const ICON_EDGE = 256;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compile one allowlist pattern into a regular expression. `*` is the only
 * metacharacter; everything else is literal.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function patternToRegExp(pattern) {
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`);
}

/**
 * Compile one group of the allowlist: category name to patterns.
 *
 * @param {object} group
 * @returns {Map<string, RegExp[]>}
 */
function compileGroup(group) {
  const out = new Map();
  for (const [key, value] of Object.entries(group ?? {})) {
    if (key.startsWith('_') || !Array.isArray(value)) continue;
    out.set(key, value.map(patternToRegExp));
  }
  return out;
}

/**
 * Load `tools/external-refs.json` as compiled matchers.
 *
 * @param {string} [file]
 * @returns {{vanilla: Map<string, RegExp[]>, companions: Array<{pack: string, patterns: Map<string, RegExp[]>}>}}
 */
function loadExternalRefs(file = path.resolve(__dirname, '..', 'external-refs.json')) {
  const doc = parseJsonc(fs.readFileSync(file, 'utf8'), 'tools/external-refs.json');
  return {
    vanilla: compileGroup(doc.vanilla),
    companions: Object.entries(doc.companion_packs ?? {}).map(([pack, group]) => ({
      pack,
      patterns: compileGroup(group),
    })),
  };
}

/**
 * Collects findings so the checks below stay one-liners.
 */
class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * @param {string} file pack path the finding belongs to
   * @param {string} message
   */
  error(file, message) {
    this.errors.push({ file, message });
  }

  /**
   * @param {string} file pack path the finding belongs to
   * @param {string} message
   */
  warn(file, message) {
    this.warnings.push({ file, message });
  }
}

/**
 * Check a version triple.
 *
 * @param {unknown} value
 * @returns {boolean} true when it is `[major, minor, patch]` of non-negative integers
 */
function isVersionTriple(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => Number.isInteger(n) && n >= 0)
  );
}

/**
 * Validate `manifest.json`, including that it agrees with `package.json` and
 * that the pack has not grown behaviour-pack surfaces.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {{version: string}} expected
 */
function checkManifest(index, report, expected) {
  const file = 'manifest.json';
  const manifest = index.manifest;
  if (!manifest) {
    report.error(file, 'manifest.json is missing or could not be parsed');
    return;
  }

  if (manifest.format_version !== 2) {
    report.error(file, `format_version must be 2, found ${JSON.stringify(manifest.format_version)}`);
  }

  const header = manifest.header;
  if (!header || typeof header !== 'object') {
    report.error(file, 'header is missing');
    return;
  }

  if (typeof header.name !== 'string' || header.name.trim() === '') {
    report.error(file, 'header.name must be a non-empty string');
  }
  if (typeof header.description !== 'string') {
    report.error(file, 'header.description must be a string');
  }
  if (typeof header.uuid !== 'string' || !UUID_RE.test(header.uuid)) {
    report.error(file, `header.uuid is not a UUID: ${JSON.stringify(header.uuid)}`);
  }
  if (!isVersionTriple(header.version)) {
    report.error(file, 'header.version must be [major, minor, patch] of integers');
  }
  if (!isVersionTriple(header.min_engine_version)) {
    report.error(file, 'header.min_engine_version must be [major, minor, patch] of integers');
  }

  const modules = manifest.modules;
  if (!Array.isArray(modules) || modules.length === 0) {
    report.error(file, 'modules must be a non-empty array');
  } else {
    let resourceModules = 0;
    modules.forEach((mod, i) => {
      const at = `modules[${i}]`;
      if (BEHAVIOUR_MODULE_TYPES.has(mod?.type)) {
        report.error(file, `${at}.type is "${mod.type}"; this pack ships resource-pack content only`);
      } else if (!RESOURCE_MODULE_TYPES.has(mod?.type)) {
        report.error(file, `${at}.type is not a recognised resource-pack module type: ${JSON.stringify(mod?.type)}`);
      }
      if (mod?.type === 'resources') resourceModules += 1;
      if (typeof mod?.uuid !== 'string' || !UUID_RE.test(mod.uuid)) {
        report.error(file, `${at}.uuid is not a UUID: ${JSON.stringify(mod?.uuid)}`);
      }
      if (!isVersionTriple(mod?.version)) {
        report.error(file, `${at}.version must be [major, minor, patch] of integers`);
      }
    });
    if (resourceModules !== 1) {
      report.error(file, `expected exactly one "resources" module, found ${resourceModules}`);
    }
  }

  const uuids = [header?.uuid, ...(Array.isArray(modules) ? modules.map((m) => m?.uuid) : [])]
    .filter((u) => typeof u === 'string')
    .map((u) => u.toLowerCase());
  if (new Set(uuids).size !== uuids.length) {
    report.error(file, 'header and module UUIDs must all differ');
  }

  if (manifest.dependencies !== undefined) {
    const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
    for (const dep of deps) {
      if (typeof dep?.module_name === 'string' && dep.module_name.startsWith('@minecraft/')) {
        report.error(file, `dependency on ${dep.module_name}: script APIs are behaviour-pack only`);
      }
    }
  }
  if (manifest.capabilities !== undefined) {
    for (const cap of manifest.capabilities) {
      if (cap === 'script_eval' || cap === 'experimental_custom_ui') {
        report.error(file, `capability "${cap}" is not resource-pack content`);
      }
    }
  }

  // Version and naming conventions from CLAUDE.md.
  const expectedTriple = expected.version.split('.').map(Number);
  if (isVersionTriple(header.version) && header.version.join('.') !== expectedTriple.join('.')) {
    report.error(
      file,
      `header.version [${header.version.join(', ')}] does not match package.json version ${expected.version}`,
    );
  }
  const prefix = `v${expected.version} — `;
  if (typeof header.description === 'string' && !header.description.startsWith(prefix)) {
    report.error(file, `header.description must start with "${prefix}"`);
  }
}

/**
 * Check the files themselves: parse failures, duplicate identifiers, corrupt
 * or missing images, and anything sitting in the repository root that the
 * archive will silently leave behind.
 *
 * @param {object} index pack index
 * @param {Report} report
 */
function checkFiles(index, report) {
  for (const missing of index.missingRoots) {
    report.error(missing, 'required pack file is missing');
  }
  for (const { packPath, message } of index.parseErrors) {
    report.error(packPath, `does not parse: ${message}`);
  }
  for (const { kind, id, paths } of index.duplicates) {
    report.error(paths[1], `${kind} "${id}" is already defined in ${paths[0]}`);
  }

  for (const packPath of index.files) {
    if (!packPath.toLowerCase().endsWith('.png')) continue;
    if (!readPngHeader(path.join(index.root, packPath)).valid) {
      report.error(packPath, 'is named .png but does not start with a PNG signature');
    }
  }

  const known = new Set([...PACK_ROOTS.map((e) => e.toLowerCase()), ...DEV_ENTRIES]);
  for (const entry of fs.readdirSync(index.root)) {
    if (!known.has(entry.toLowerCase())) {
      report.warn(entry, 'is neither a pack root nor known development material, so it will not ship');
    }
  }
}

/**
 * Check `pack_icon.png` against Microsoft's documented rules for it.
 *
 * The icon is what players pick the pack out by in the resource pack list, and
 * nothing in the game complains when it is wrong — it just draws badly. The
 * rules and their severities are Microsoft's, from the Creator Tools validation
 * reference (CPACKICON101-104); the rule IDs are quoted in the messages so the
 * origin of each is traceable.
 *
 * CPACKICON101 (missing) is stricter here than the documented warning: the
 * build refuses to package without an icon, since `pack_icon.png` is a required
 * pack root. CPACKICON103 (not a PNG) is covered by the signature check on
 * every image.
 *
 * @param {object} index pack index
 * @param {Report} report
 */
function checkPackIcon(index, report) {
  const ICON = 'pack_icon.png';
  if (!index.files.includes(ICON)) return; // reported as a missing pack root

  // CPACKICON102: one icon per pack root. A subpack legitimately carries its
  // own, so only copies outside `subpacks/` are stray.
  for (const packPath of index.files) {
    if (packPath === ICON) continue;
    if (!packPath.toLowerCase().endsWith(`/${ICON}`)) continue;
    if (packPath.startsWith('subpacks/')) continue;
    report.warn(packPath, `CPACKICON102: a second pack icon; only ${ICON} in the pack root is used`);
  }

  // CPACKICON104: square, and 256x256 for the best display.
  const { width, height } = readPngHeader(path.join(index.root, ICON));
  if (width === null || height === null) return; // not a PNG; CPACKICON103 said so

  if (width !== height) {
    report.warn(ICON, `CPACKICON104: must be square, found ${width}x${height}`);
  } else if (width !== ICON_EDGE) {
    report.warn(ICON, `CPACKICON104: should be ${ICON_EDGE}x${ICON_EDGE}, found ${width}x${height}`);
  }
}

/**
 * Decide whether something outside this pack supplies `ref`.
 *
 * A vanilla match is silent. A companion-pack match is real but conditional:
 * the identifier exists only while that pack is loaded too, and Minecraft logs
 * a content error for it when it is not, so it is surfaced as a warning. That
 * keeps a deliberate interoperability hook from looking like a clean resolve.
 *
 * @param {{vanilla: Map<string, RegExp[]>, companions: Array<{pack: string, patterns: Map<string, RegExp[]>}>}} external
 * @param {Report} report
 * @param {string} file pack path making the reference
 * @param {string} category allowlist category
 * @param {string} ref the identifier or path being referenced
 * @param {string} where field the reference sits in, for the message
 * @returns {boolean} true when the reference is accounted for
 */
function accountedFor(external, report, file, category, ref, where) {
  if ((external.vanilla.get(category) ?? []).some((re) => re.test(ref))) return true;

  for (const { pack, patterns } of external.companions) {
    if (!(patterns.get(category) ?? []).some((re) => re.test(ref))) continue;
    report.warn(
      file,
      `${where} names "${ref}", which ${pack} provides — Minecraft logs a content error for it ` +
        `in any world where ${pack} is not also loaded`,
    );
    return true;
  }

  return false;
}

/**
 * Resolve every reference an entity definition makes.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {Map<string, RegExp[]>} external
 * @param {Set<string>} used identifiers seen, filled in for the orphan check
 */
function checkEntities(index, report, external, used) {
  for (const { packPath, description } of index.entities) {
    const textures = description.textures ?? {};
    const geometry = description.geometry ?? {};
    const materials = description.materials ?? {};
    const animations = description.animations ?? {};
    const particles = description.particle_effects ?? {};

    for (const [short, ref] of Object.entries(textures)) {
      if (typeof ref !== 'string') continue;
      const resolved = resolveTexture(index, ref);
      if (resolved) used.add(`texture:${resolved}`);
      else if (!accountedFor(external, report, packPath, 'texture', ref, `textures.${short}`)) {
        report.error(packPath, `textures.${short} -> "${ref}" matches no file (check spelling and letter case)`);
      }
    }

    for (const [short, ref] of Object.entries(geometry)) {
      if (typeof ref !== 'string') continue;
      if (index.geometries.has(ref)) used.add(`geometry:${ref}`);
      else if (!accountedFor(external, report, packPath, 'geometry', ref, `geometry.${short}`)) {
        report.error(packPath, `geometry.${short} -> "${ref}" is not defined by any model in models/`);
      }
    }

    for (const [short, ref] of Object.entries(materials)) {
      if (typeof ref !== 'string') continue;
      if (index.materials.has(ref)) used.add(`material:${ref}`);
      else if (!accountedFor(external, report, packPath, 'material', ref, `materials.${short}`)) {
        report.error(packPath, `materials.${short} -> "${ref}" is not defined in materials/`);
      }
    }

    for (const [short, ref] of Object.entries(animations)) {
      if (typeof ref !== 'string') continue;
      const isController = ref.startsWith('controller.animation.');
      const table = isController ? index.animationControllers : index.animations;
      if (table.has(ref)) used.add(`${isController ? 'animation_controller' : 'animation'}:${ref}`);
      else if (!accountedFor(external, report, packPath, 'animation', ref, `animations.${short}`)) {
        const where = isController ? 'animation_controllers/' : 'animations/';
        report.error(packPath, `animations.${short} -> "${ref}" is not defined in ${where}`);
      }
    }

    for (const [short, ref] of Object.entries(particles)) {
      if (typeof ref !== 'string') continue;
      if (index.particles.has(ref)) used.add(`particle:${ref}`);
      else if (!accountedFor(external, report, packPath, 'particle', ref, `particle_effects.${short}`)) {
        report.error(packPath, `particle_effects.${short} -> "${ref}" is not defined in particles/`);
      }
    }

    // `scripts.animate` entries are short names from the entity's own
    // animations map, not identifiers. A name with no entry there animates
    // nothing at all, silently.
    const animate = description.scripts?.animate ?? [];
    for (const item of animate) {
      const name = typeof item === 'string' ? item : Object.keys(item ?? {})[0];
      if (typeof name !== 'string') continue;
      if (Object.prototype.hasOwnProperty.call(animations, name)) continue;
      if (accountedFor(external, report, packPath, 'animate', name, 'scripts.animate')) continue;
      report.warn(packPath, `scripts.animate lists "${name}", which is not a key of this entity's animations map`);
    }

    for (const item of description.render_controllers ?? []) {
      const id = typeof item === 'string' ? item : Object.keys(item ?? {})[0];
      if (typeof id !== 'string') continue;
      if (index.renderControllers.has(id)) {
        used.add(`render_controller:${id}`);
        checkRenderController(index, report, packPath, id, { textures, geometry, materials });
      } else if (!accountedFor(external, report, packPath, 'render_controller', id, 'render_controllers')) {
        report.error(packPath, `render_controllers lists "${id}", which is not defined in render_controllers/`);
      }
    }
  }
}

/**
 * Resolve the short names a render controller uses against the entity that
 * references it.
 *
 * A render controller does not name assets directly; it names entries in the
 * referencing entity's `textures`, `geometry` and `materials` maps
 * (`Texture.foo`, `Geometry.foo`, `Material.foo`, case-insensitively). The same
 * controller can therefore be valid for one entity and broken for another,
 * which is why this is checked per reference rather than per file.
 *
 * Values that are Molang rather than a bare short name (array lookups,
 * conditionals) are skipped: they cannot be resolved without running the game.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {string} entityPath entity making the reference
 * @param {string} id render controller identifier
 * @param {{textures: object, geometry: object, materials: object}} maps entity short-name maps
 */
function checkRenderController(index, report, entityPath, id, maps) {
  const entry = index.renderControllerBodies.get(id);
  if (!entry) return;
  const body = entry.body ?? {};

  /**
   * @param {unknown} value candidate short-name reference
   * @param {'Geometry'|'Texture'|'Material'} kind
   * @param {object} table entity map the short name must appear in
   * @param {string} field field name for the message
   */
  const resolve = (value, kind, table, field) => {
    if (typeof value !== 'string') return;
    const match = /^(geometry|texture|material)\.([A-Za-z0-9_]+)$/i.exec(value.trim());
    if (!match) return; // Molang expression; not statically resolvable.
    if (match[1].toLowerCase() !== kind.toLowerCase()) {
      report.error(entry.packPath, `${id}.${field} uses "${value}" where a ${kind}.* reference is expected`);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(table, match[2])) {
      report.error(
        entry.packPath,
        `${id}.${field} -> "${value}" but ${entityPath} declares no ${kind.toLowerCase()} named "${match[2]}"`,
      );
    }
  };

  resolve(body.geometry, 'Geometry', maps.geometry, 'geometry');

  for (const texture of body.textures ?? []) {
    resolve(texture, 'Texture', maps.textures, 'textures');
  }

  for (const material of body.materials ?? []) {
    if (!material || typeof material !== 'object') continue;
    for (const value of Object.values(material)) {
      resolve(value, 'Material', maps.materials, 'materials');
    }
  }
}

/**
 * Resolve the assets particle definitions name directly.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {Map<string, RegExp[]>} external
 * @param {Set<string>} used
 */
function checkParticles(index, report, external, used) {
  for (const [id, { packPath, doc }] of index.particleBodies) {
    const params = doc.particle_effect?.description?.basic_render_parameters ?? {};

    if (typeof params.texture === 'string') {
      const resolved = resolveTexture(index, params.texture);
      if (resolved) used.add(`texture:${resolved}`);
      else if (!accountedFor(external, report, packPath, 'texture', params.texture, `${id} texture`)) {
        report.error(packPath, `${id} draws with texture "${params.texture}", which matches no file`);
      }
    }

    if (typeof params.material === 'string') {
      const material = params.material;
      if (index.materials.has(material)) used.add(`material:${material}`);
      else if (!accountedFor(external, report, packPath, 'material', material, `${id} material`)) {
        report.error(packPath, `${id} draws with material "${material}", which is not defined in materials/`);
      }
    }
  }
}

/**
 * Resolve the animations an animation controller plays.
 *
 * Controller states name short names from the referencing entity's animations
 * map, so the only thing checkable here is that the name is declared by at
 * least one entity that uses the controller.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {Set<string>} used
 */
function checkAnimationControllers(index, report, used) {
  /** Short names declared by any entity, with the identifier each maps to. */
  const declared = new Map();
  for (const { description } of index.entities) {
    for (const [short, ref] of Object.entries(description.animations ?? {})) {
      if (typeof ref === 'string') declared.set(short, ref);
    }
  }

  for (const [packPath, doc] of index.documents) {
    if (!packPath.startsWith('animation_controllers/')) continue;
    for (const [id, controller] of Object.entries(doc.animation_controllers ?? {})) {
      for (const [stateName, state] of Object.entries(controller?.states ?? {})) {
        for (const item of state?.animations ?? []) {
          const short = typeof item === 'string' ? item : Object.keys(item ?? {})[0];
          if (typeof short !== 'string') continue;
          const ref = declared.get(short);
          if (ref === undefined) {
            report.warn(packPath, `${id} state "${stateName}" plays "${short}", which no entity declares`);
            continue;
          }
          used.add(ref.startsWith('controller.animation.') ? `animation_controller:${ref}` : `animation:${ref}`);
        }
      }
    }
  }
}

/**
 * Load the record of what vanilla's own client entities declare.
 *
 * @param {string} [file]
 * @returns {{generated_from?: string, entities: Record<string, Record<string, string[]>>}}
 */
function loadVanillaBaseline(file = path.resolve(__dirname, '..', 'vanilla-baseline.json')) {
  if (!fs.existsSync(file)) return { entities: {} };
  return parseJsonc(fs.readFileSync(file, 'utf8'), 'tools/vanilla-baseline.json');
}

/**
 * Report short names a replaced vanilla entity has dropped.
 *
 * A client entity file in a resource pack replaces the vanilla one outright —
 * the two do not merge. Vanilla's animation and render controllers keep asking
 * for the short names vanilla's copy declared, so every name missing from the
 * pack's copy is a `can't find animation <name>` in the content log and a
 * vanilla animation that no longer plays.
 *
 * This is a warning rather than an error because dropping a short name can be
 * deliberate — the pack overrides these files precisely to change what they
 * draw — and because the baseline tracks whatever version of vanilla it was
 * last generated from, which may be ahead of the client in hand. One warning
 * per entity and category, listing the names, so it stays one line.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {{entities: Record<string, Record<string, string[]>>}} baseline
 */
function checkVanillaBaseline(index, report, baseline) {
  for (const { packPath, description } of index.entities) {
    const expected = baseline.entities?.[description.identifier];
    if (!expected) continue;

    for (const [category, names] of Object.entries(expected)) {
      const declared = description[category] ?? {};
      const missing = names.filter((name) => !Object.prototype.hasOwnProperty.call(declared, name));
      if (missing.length === 0) continue;
      report.warn(
        packPath,
        `${category}: vanilla declares ${missing.length} short name(s) this copy does not — ` +
          `${missing.join(', ')}. Vanilla controllers still ask for them.`,
      );
    }
  }
}

/**
 * Report content that nothing references. Always a warning: an orphan still
 * loads, it just adds download size and is usually a leftover or a reference
 * that was meant to be wired up.
 *
 * @param {object} index pack index
 * @param {Report} report
 * @param {Set<string>} used identifiers reached by the reference checks
 */
function checkOrphans(index, report, used) {
  const groups = [
    ['geometry', index.geometries],
    ['animation', index.animations],
    ['animation_controller', index.animationControllers],
    ['render_controller', index.renderControllers],
    ['particle', index.particles],
    ['material', index.materials],
  ];

  for (const [kind, table] of groups) {
    for (const [id, packPath] of table) {
      if (!used.has(`${kind}:${id}`)) {
        report.warn(packPath, `${kind.replace(/_/g, ' ')} "${id}" is defined but never referenced`);
      }
    }
  }

  for (const packPath of index.textures.values()) {
    if (!used.has(`texture:${packPath}`)) {
      report.warn(packPath, 'texture is never referenced by an entity or particle');
    }
  }
}

/**
 * Run every check.
 *
 * @param {object} index pack index from `loadPack`
 * @param {{version: string}} expected values the manifest must agree with
 * @param {Map<string, RegExp[]>} [external] allowlist, loaded from disk by default
 * @returns {{errors: Array<{file: string, message: string}>, warnings: Array<{file: string, message: string}>}}
 */
function validatePack(index, expected, external = loadExternalRefs(), baseline = loadVanillaBaseline()) {
  const report = new Report();
  const used = new Set();

  checkFiles(index, report);
  checkPackIcon(index, report);
  checkManifest(index, report, expected);
  checkEntities(index, report, external, used);
  checkParticles(index, report, external, used);
  checkAnimationControllers(index, report, used);
  checkVanillaBaseline(index, report, baseline);
  checkOrphans(index, report, used);

  return { errors: report.errors, warnings: report.warnings };
}

module.exports = {
  DEV_ENTRIES,
  ICON_EDGE,
  Report,
  loadExternalRefs,
  loadVanillaBaseline,
  patternToRegExp,
  validatePack,
};
