'use strict';

/**
 * Builds throwaway packs on disk for the validator tests.
 *
 * The validator reads real files — that is the point of it, since half of what
 * it catches is about what is on disk rather than what is in a document — so
 * the tests give it real files. Fixtures live under `tests/.generated/` so a
 * failed run can be opened and looked at.
 */

const fs = require('node:fs');
const path = require('node:path');
const { makePng } = require('./png.js');

const GENERATED = path.resolve(__dirname, '..', '.generated');

/** A pack with one of everything, all references resolving. */
function basePack(version = '1.2.3') {
  const [major, minor, fix] = version.split('.').map(Number);
  return {
    'manifest.json': {
      format_version: 2,
      header: {
        description: `v${version} — fixture`,
        name: `BE_Tech_RP_v${version}`,
        uuid: '11111111-2222-4333-8444-555555555555',
        version: [major, minor, fix],
        min_engine_version: [1, 21, 1],
      },
      modules: [
        {
          description: '',
          type: 'resources',
          uuid: '66666666-7777-4888-8999-aaaaaaaaaaaa',
          version: [0, 0, 1],
        },
      ],
    },
    'entity/test.entity.json': {
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: 'minecraft:armor_stand',
          materials: { fixture: 'be_fixture' },
          textures: { fixture: 'textures/fixture' },
          geometry: { fixture: 'geometry.fixture' },
          animations: {
            fixture: 'animation.fixture',
            fixture_control: 'controller.animation.fixture',
          },
          particle_effects: { fixture: 'addon:fixture' },
          scripts: { animate: ['fixture_control'] },
          render_controllers: ['controller.render.fixture'],
        },
      },
    },
    'models/entity/fixture.geo.json': {
      format_version: '1.12.0',
      'minecraft:geometry': [
        { description: { identifier: 'geometry.fixture' }, bones: [] },
      ],
    },
    'materials/entity.material': {
      materials: { version: '1.0.0', 'be_fixture:entity_alphablend': {} },
    },
    'animations/fixture.json': {
      format_version: '1.8.0',
      animations: { 'animation.fixture': { loop: true } },
    },
    'animation_controllers/fixture.json': {
      format_version: '1.10.0',
      animation_controllers: {
        'controller.animation.fixture': {
          initial_state: 'default',
          states: { default: { animations: ['fixture'] } },
        },
      },
    },
    'render_controllers/fixture.json': {
      format_version: '1.8.0',
      render_controllers: {
        'controller.render.fixture': {
          geometry: 'Geometry.fixture',
          materials: [{ '*': 'Material.fixture' }],
          textures: ['Texture.fixture'],
        },
      },
    },
    'particles/fixture.json': {
      format_version: '1.10.0',
      particle_effect: {
        description: {
          identifier: 'addon:fixture',
          basic_render_parameters: { material: 'particles_blend', texture: 'textures/fixture' },
        },
        components: {},
      },
    },
  };
}

/** A real 16x16 PNG, the size a block texture would be. */
const PNG = makePng(16, 16);

/** A pack icon at the 256x256 Microsoft documents (CPACKICON104). */
const ICON = makePng(256, 256);

/**
 * Write a pack to disk.
 *
 * @param {string} name fixture directory name
 * @param {object} [options]
 * @param {(docs: Record<string, any>) => void} [options.mutate] edit the documents before writing
 * @param {Record<string, Buffer|string>} [options.raw] extra files written verbatim
 * @param {string} [options.version]
 * @returns {string} absolute path to the fixture pack root
 */
function writeFixture(name, { mutate, raw = {}, version = '1.2.3' } = {}) {
  const root = path.join(GENERATED, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  const docs = basePack(version);
  if (mutate) mutate(docs);

  const files = {
    ...Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, JSON.stringify(v, null, 2)])),
    'pack_icon.png': ICON,
    'textures/fixture.png': PNG,
    ...raw,
  };

  for (const [rel, data] of Object.entries(files)) {
    if (data == null) continue; // a fixture may delete a file by nulling it out
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }

  return root;
}

/**
 * @param {string} version
 * @returns {{version: string, packName: string}} what the manifest must agree with
 */
function expectationsFor(version = '1.2.3') {
  return { version, packName: `BE_Tech_RP_v${version}` };
}

module.exports = { GENERATED, basePack, writeFixture, expectationsFor, PNG, ICON, makePng };
