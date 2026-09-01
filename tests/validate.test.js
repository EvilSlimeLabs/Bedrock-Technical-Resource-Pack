'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPack } = require('../tools/lib/pack.js');
const { validatePack, patternToRegExp, loadExternalRefs } = require('../tools/lib/validate.js');
const { writeFixture, expectationsFor, PNG, makePng } = require('./helpers/fixture.js');

/**
 * Build a fixture and validate it.
 *
 * @param {string} name
 * @param {object} [options] passed through to `writeFixture`; `external` overrides
 *   the borrowed-identifier allowlist and `baseline` overrides
 *   the vanilla short-name baseline, which is empty here so fixtures are judged
 *   on their own contents rather than on what vanilla currently ships
 * @returns {{errors: Array<{file: string, message: string}>, warnings: Array<{file: string, message: string}>}}
 */
function validateFixture(name, options) {
  const root = writeFixture(name, options);
  const baseline = options?.baseline ?? { entities: {} };
  const external = options?.external ?? loadExternalRefs();
  return validatePack(loadPack(root), expectationsFor(options?.version), external, baseline);
}

/**
 * @param {Array<{file: string, message: string}>} findings
 * @param {RegExp} pattern
 * @returns {boolean}
 */
const has = (findings, pattern) => findings.some((f) => pattern.test(`${f.file} ${f.message}`));

/**
 * @param {Array<{file: string, message: string}>} findings
 * @returns {string} readable dump for assertion messages
 */
const dump = (findings) => findings.map((f) => `${f.file}: ${f.message}`).join('\n') || '(none)';

test('a well-formed pack produces no findings at all', () => {
  const { errors, warnings } = validateFixture('clean');
  assert.deepEqual(errors, [], dump(errors));
  assert.deepEqual(warnings, [], dump(warnings));
});

test('a texture reference with no file behind it is an error', () => {
  const { errors } = validateFixture('missing-texture', { raw: { 'textures/fixture.png': null } });
  assert.ok(has(errors, /textures\.fixture .* matches no file/), dump(errors));
});

test('a texture reference in the wrong letter case is an error', () => {
  // Windows would load this happily; Android and consoles would not.
  const { errors } = validateFixture('wrong-case', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.textures.fixture =
        'textures/Fixture';
    },
  });
  assert.ok(has(errors, /letter case/), dump(errors));
});

test('a geometry no model defines is an error', () => {
  const { errors } = validateFixture('missing-geometry', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.geometry.fixture =
        'geometry.typo';
    },
  });
  assert.ok(has(errors, /geometry\.typo" is not defined/), dump(errors));
});

test('an animation no file defines is an error', () => {
  const { errors } = validateFixture('missing-animation', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.animations.fixture =
        'animation.typo';
    },
  });
  assert.ok(has(errors, /animation\.typo" is not defined in animations\//), dump(errors));
});

test('a particle no file defines is an error', () => {
  const { errors } = validateFixture('missing-particle', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.particle_effects.fixture =
        'addon:typo';
    },
  });
  assert.ok(has(errors, /addon:typo" is not defined/), dump(errors));
});

test('the same identifier defined twice is an error', () => {
  const { errors } = validateFixture('duplicate-geometry', {
    mutate: (docs) => {
      docs['models/entity/copy.geo.json'] = docs['models/entity/fixture.geo.json'];
    },
  });
  assert.ok(has(errors, /geometry "geometry\.fixture" is already defined/), dump(errors));
});

test('a render controller naming a short name the entity never declared is an error', () => {
  const { errors } = validateFixture('render-controller-short-name', {
    mutate: (docs) => {
      docs['render_controllers/fixture.json'].render_controllers['controller.render.fixture'].textures = [
        'Texture.absent',
      ];
    },
  });
  assert.ok(has(errors, /declares no texture named "absent"/), dump(errors));
});

test('a Molang render controller value is left alone rather than guessed at', () => {
  const { errors } = validateFixture('render-controller-molang', {
    mutate: (docs) => {
      docs['render_controllers/fixture.json'].render_controllers['controller.render.fixture'].textures = [
        "Array.skins[query.variant ? 1 : 0]",
      ];
    },
  });
  assert.deepEqual(errors, [], dump(errors));
});

test('an animate entry that is not a key of the animations map is a warning', () => {
  const { errors, warnings } = validateFixture('stray-animate', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.scripts.animate = ['nope'];
    },
  });
  assert.deepEqual(errors, [], dump(errors));
  assert.ok(has(warnings, /animate lists "nope"/), dump(warnings));
});

test('content nothing references is a warning, not an error', () => {
  const { errors, warnings } = validateFixture('orphan', {
    mutate: (docs) => {
      docs['models/entity/spare.geo.json'] = {
        format_version: '1.12.0',
        'minecraft:geometry': [{ description: { identifier: 'geometry.spare' }, bones: [] }],
      };
    },
    raw: { 'textures/spare.png': PNG },
  });
  assert.deepEqual(errors, [], dump(errors));
  assert.ok(has(warnings, /geometry "geometry\.spare" is defined but never referenced/), dump(warnings));
  assert.ok(has(warnings, /textures\/spare\.png .* never referenced/), dump(warnings));
});

test('a manifest version that disagrees with package.json is an error', () => {
  const { errors } = validateFixture('version-drift', {
    mutate: (docs) => {
      docs['manifest.json'].header.version = [9, 9, 9];
    },
  });
  assert.ok(has(errors, /does not match package\.json version/), dump(errors));
});

test('a description without its version prefix is an error', () => {
  const { errors } = validateFixture('no-prefix', {
    mutate: (docs) => {
      docs['manifest.json'].header.description = 'no prefix here';
    },
  });
  assert.ok(has(errors, /must start with "v1\.2\.3 — "/), dump(errors));
});

test('a behaviour-pack module is an error, because this pack ships resources only', () => {
  const { errors } = validateFixture('behaviour-module', {
    mutate: (docs) => {
      docs['manifest.json'].modules.push({
        type: 'data',
        uuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        version: [0, 0, 1],
      });
    },
  });
  assert.ok(has(errors, /ships resource-pack content only/), dump(errors));
});

test('a script API dependency is an error', () => {
  const { errors } = validateFixture('script-dependency', {
    mutate: (docs) => {
      docs['manifest.json'].dependencies = [{ module_name: '@minecraft/server', version: '1.0.0' }];
    },
  });
  assert.ok(has(errors, /behaviour-pack only/), dump(errors));
});

test('a reused UUID is an error', () => {
  const { errors } = validateFixture('duplicate-uuid', {
    mutate: (docs) => {
      docs['manifest.json'].modules[0].uuid = docs['manifest.json'].header.uuid;
    },
  });
  assert.ok(has(errors, /UUIDs must all differ/), dump(errors));
});

test('a malformed UUID is an error', () => {
  const { errors } = validateFixture('bad-uuid', {
    mutate: (docs) => {
      docs['manifest.json'].header.uuid = 'not-a-uuid';
    },
  });
  assert.ok(has(errors, /header\.uuid is not a UUID/), dump(errors));
});

test('a file that does not parse is reported once, by name', () => {
  const { errors } = validateFixture('broken-json', {
    raw: { 'animations/broken.json': '{ "animations": { ' },
  });
  assert.ok(has(errors, /animations\/broken\.json.*does not parse/), dump(errors));
});

test('a .png that is not a PNG is an error', () => {
  const { errors } = validateFixture('fake-png', {
    raw: { 'textures/fixture.png': Buffer.from('GIF89a not really a png') },
  });
  assert.ok(has(errors, /does not start with a PNG signature/), dump(errors));
});

test('a pack icon that is not 256x256 is a warning', () => {
  // Microsoft's CPACKICON104: square, and 256x256 for the best display.
  const { errors, warnings } = validateFixture('icon-small', {
    raw: { 'pack_icon.png': makePng(64, 64) },
  });
  assert.deepEqual(errors, [], dump(errors));
  assert.ok(has(warnings, /CPACKICON104: should be 256x256, found 64x64/), dump(warnings));
});

test('a pack icon that is not square is a warning', () => {
  const { warnings } = validateFixture('icon-oblong', {
    raw: { 'pack_icon.png': makePng(256, 128) },
  });
  assert.ok(has(warnings, /CPACKICON104: must be square, found 256x128/), dump(warnings));
});

test('a correctly sized pack icon says nothing', () => {
  const { warnings } = validateFixture('icon-ok');
  assert.ok(!has(warnings, /CPACKICON/), dump(warnings));
});

test('a second pack icon outside the root is a warning', () => {
  const { warnings } = validateFixture('icon-duplicate', {
    raw: { 'textures/pack_icon.png': makePng(256, 256) },
  });
  assert.ok(has(warnings, /CPACKICON102: a second pack icon/), dump(warnings));
});

test('a subpack keeps its own icon without complaint', () => {
  const { warnings } = validateFixture('icon-subpack', {
    raw: { 'subpacks/hd/pack_icon.png': makePng(256, 256) },
  });
  assert.ok(!has(warnings, /CPACKICON102/), dump(warnings));
});

test('a missing pack icon is an error', () => {
  const { errors } = validateFixture('no-icon', { raw: { 'pack_icon.png': null } });
  assert.ok(has(errors, /pack_icon\.png.*missing/), dump(errors));
});

test('a replaced vanilla entity that drops vanilla short names is a warning', () => {
  // The pack's copy of a client entity replaces vanilla's outright, so a short
  // name it fails to carry over is one vanilla's own controllers still ask for.
  const { errors, warnings } = validateFixture('vanilla-drift', {
    baseline: {
      entities: {
        'minecraft:armor_stand': {
          animations: ['fixture', 'controller.pose', 'wiggle'],
          textures: ['default'],
        },
      },
    },
  });
  assert.deepEqual(errors, [], dump(errors));
  assert.ok(has(warnings, /animations: vanilla declares 2 short name\(s\)/), dump(warnings));
  assert.ok(has(warnings, /controller\.pose, wiggle/), dump(warnings));
  assert.ok(has(warnings, /textures: vanilla declares 1 short name\(s\)/), dump(warnings));
});

test('a vanilla entity the baseline does not cover is left alone', () => {
  const { warnings } = validateFixture('vanilla-unknown', { baseline: { entities: {} } });
  assert.ok(!has(warnings, /vanilla declares/), dump(warnings));
});

test('a reference another pack provides resolves, but is warned about', () => {
  // Structura's render controller is real, but only while Structura is loaded;
  // Minecraft logs a content error for it in any world where it is not.
  const { errors, warnings } = validateFixture('companion-pack', {
    // The real vanilla list, plus a companion pack declared here so the test
    // does not depend on which borrows the shipped allowlist happens to hold.
    external: {
      ...loadExternalRefs(),
      companions: [
        {
          pack: 'Structura',
          patterns: new Map([['render_controller', [/^controller\.render\.armor_stand\.ghost_blocks$/]]]),
        },
      ],
    },
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.render_controllers.push(
        'controller.render.armor_stand.ghost_blocks',
      );
    },
  });
  assert.deepEqual(errors, [], dump(errors));
  assert.ok(has(warnings, /which Structura provides/), dump(warnings));
  assert.ok(has(warnings, /where Structura is not also loaded/), dump(warnings));
});

test('a reference nothing provides is still an error', () => {
  const { errors } = validateFixture('companion-typo', {
    mutate: (docs) => {
      docs['entity/test.entity.json']['minecraft:client_entity'].description.render_controllers.push(
        'controller.render.armor_stand.ghost_block',
      );
    },
  });
  assert.ok(has(errors, /ghost_block", which is not defined/), dump(errors));
});

test('allowlist patterns match on * and nothing else', () => {
  assert.ok(patternToRegExp('animation.player.*').test('animation.player.cape'));
  assert.ok(!patternToRegExp('animation.player.*').test('animation.playerx'));
  assert.ok(patternToRegExp('controller.pose').test('controller.pose'));
  assert.ok(!patternToRegExp('controller.pose').test('controllerXpose'));
});
