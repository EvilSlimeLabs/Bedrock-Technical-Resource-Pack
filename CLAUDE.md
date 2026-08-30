# Working on this add-on

Standing rules and the project information worth having before touching
anything. Everything here is general Bedrock add-on practice..

---

## The project

**Bedrock Technical Resource Pack** — This is a project that aims to provide tools to design and build farms in a survival/achievements enabled world. This means we are not using behavior packs, commands, or other items that the normal player on a typical server would not have access to. To do that we have to use an armor stand as an anchor for the tools as it is the only entity that can be placed on a single block and be switched manipulated.

## Finish every round with a version bump

**Every time a set of tasks is completed, bump the version.** This is not
something to ask about or offer; it is part of finishing the work. If a round of
changes is done and the version has not moved, the round is not done.

- **Major** (`1.2.0` → `2.0.0`) — a change that breaks existing worlds, or a
  change that is so large it is not worth enumerating the minor and fix changes
  that went into it.
- **Minor** (`1.2.0` → `1.3.0`) — new behaviour a player or admin can notice: a
  new command, menu, setting, block or item, or a change to what an existing
  feature does.
- **Fix** (`1.2.0` → `1.2.1`) — refinements to what is already there: bug fixes,
  texture and model iterations, wording, layout, internal restructuring with no
  visible change in behaviour.

When a round contains both a minor and a fix, the minor bump wins and the fix digit resets to
zero. When the major digit is incremented, the minor and fix digits reset to zero.

The user will sometimes say a change "rolls into" the previous one and does not
increment the counter. That overrides the rule for that round.

### Where the version lives

- `package.json` — the `"version"` string. This is the source of truth; every
  other copy is checked against it.
- `manifest.json` — `header.version`, the array form `[major, minor, fix]`.
- `manifest.json` — `header.name`, which is `BE_Tech_RP_v<version>`. It is what
  the player sees in the resource pack list, so it carries the version to make
  the applied build obvious in a screenshot.
- `manifest.json` — `header.description`, which leads with `v<version> — `.

`npm run set-version -- <major|minor|fix|x.y.z>` moves all four together and is
the only thing that should be editing them. The bump words follow the rules
above: `major` resets the minor and fix digits, `minor` resets the fix digit.

Do not hand-edit the version in one place and expect the other to follow.
`npm run audit` fails when the four disagree, which is deliberate — a pack whose
`header.version` did not move installs *over* the previous one instead of
alongside it, and the player sees no change.

`package.json`'s `"description"` is npm metadata, never shown in game, and is
left alone.

`npm run build` deletes the previous version's artifacts from `dist/` on its
way past — artifacts are named by version and the folder would otherwise
accumulate a set per release.

---

## This is a Minecraft Resource Pack ONLY

This addon is a resource pack, not a behavior pack. It is limited to resource pack features ONLY, STRICTLY. It does not use any behavior pack features, commands, or other items that the normal player on a typical server would not have access to. This is to ensure that the tools provided can be used in a survival/achievements enabled world without any unfair advantages. It also allows the tools to be used on any server without requiring special permissions or modifications.

---

## Every bump ships with a summary and a commit message

Hand over both in the same reply as the bump, without being asked, at the end
after describing the work. They are written for different readers and should not
be the same sentence.

**Release summary** — one or two sentences on what is new and what changed, in
prose. Add a short clause only if something breaks an existing world and the
user has to act on it. Not a formatted document, not a section per subsystem,
not an artifact. Write it directly in the reply.

**Commit message** — one line, a few words, in the user's own log style. No
body, no bullets, no test counts. Real examples from the log:

```
First release
Bugfixes
Fixed and updated items
Revamped the compass to the ledger. More item fixes. Bracket customization.
Changed Sigil watermark in the menu
```

Brevity here is about summaries and commit messages only. Detailed technical
explanation while working through a problem is welcome.

---

## Choosing between stable and beta script APIs

1. **If a requirement can be met with stable APIs, it must be.** Never reach for
   a beta API out of convenience or because it is more ergonomic.
2. **If it genuinely cannot, do not silently drop the requirement.** Use a beta
   API, but pick the most established one that achieves the goal — prefer
   long-lived beta surfaces over ones that shipped very recently.

Before concluding a feature is impossible, or before choosing beta, **verify
against the real published type definitions** rather than from memory. Grep
`node_modules/@minecraft/server/index.d.ts`. The documentation site sometimes
shows examples for APIs no longer in the stable module, and enumerating a class
in the `.d.ts` has more than once turned up a method that a keyword search
missed.

---

## Comments describe how things work, not how they were decided

Write comments that explain mechanism, logic flow, and anything a reader needs
in order to change the code safely. **Do not** record decision history: what was
tried and rejected, what a previous version did, which bug prompted a change,
what was weighed against what. That belongs in the commit log and
`NEXT_UPDATE.md`.

Empirical facts about engine behaviour are worth keeping, stated as facts —
"the X axis runs opposite to the Z axis here" rather than "this took three
builds to work out".

Match the surrounding density: module headers carry a short orientation, exported
functions carry JSDoc with types, and inline comments explain the non-obvious.

---

## Compiling the `.mcpack`

`npm run build` is the compiler. It lives in `tools/` and is plain Node with no
dependencies — no install step, no lockfile, nothing to keep current. Everything
below is the reasoning the tooling encodes; read it before changing any of it.

### What an `.mcpack` actually is

A ZIP archive with the extension changed. Everything that makes one work or not
work is about the archive's shape:

- **The pack root is the archive root.** `manifest.json` must be a top-level
  entry. If the archive contains a wrapper folder — the shape you get from
  right-click → "Send to → Compressed folder" on the project directory —
  Minecraft imports it without an error and the pack never appears in the list.
- **Entry paths use forward slashes**, always, whatever the host OS. A backslash
  in an entry name is a path component to Bedrock, not a separator.
- **Directory entries are not needed** and are not emitted. Nor is anything the
  host OS wants to add: no `__MACOSX`, no `.DS_Store`, no `Thumbs.db`.
- **Classic 32-bit ZIP only.** No ZIP64, no encryption, no data descriptors.
- Compression is optional per entry. `tools/lib/zip.js` deflates, then keeps the
  stored bytes whenever deflating did not actually shrink the entry — which is
  the usual outcome for PNG.
- The build is **reproducible**: entries are sorted, timestamps are fixed, and
  `manifest.json` and `pack_icon.png` are written first. The same tree always
  produces the same bytes, so a changed `sha256` in the build output means the
  content changed.

`tools/lib/zip.js` writes the archive by hand rather than shelling out to `zip`
or `Compress-Archive` precisely because those decide the four points above for
themselves, differently on each platform.

### What ships

`PACK_ROOTS` in `tools/lib/pack.js` is an allowlist of top-level entries. A file
outside them does not ship, full stop. Adding a new resource-pack folder means
adding it there; until it is, the build leaves it out and the audit warns that
something in the root is neither pack content nor known development material.

An allowlist rather than an exclude list, because the failure modes are not
symmetric: forgetting to exclude ships the repository's documentation images and
tooling to every player, while forgetting to include is caught by the audit the
first time something references the missing file.

### The pack icon

`pack_icon.png` must be a valid PNG, square, and **256×256** — the size
Microsoft documents for the pack selection screens. There is one per pack root;
a subpack carries its own, nothing else should. The audit checks all of this,
quoting the rule IDs from Microsoft's Creator Tools validation reference
(`CPACKICON101`–`104`) so each message can be traced back to the rule it came
from. Their severities are followed too, except that a missing icon is an error
here rather than a warning, because `pack_icon.png` is a required pack root.

The icon is an output, not something to edit by hand. `branding/` holds what
produces it — the source background, the generator, and the full-size renders —
and is development material, so it does not ship. Change the icon by editing
`branding/make_icon.py` and re-running `python branding/make_icon.py`, which
rewrites `pack_icon.png` along with the full-size composite and a
`branding/pack_icon_256.png` copy — the same bytes the pack ships, kept there so
the icon can be previewed at the size the game draws it. The generator needs
Pillow and, the first time, the network, so it is not part of `npm run release`.

### Bedrock is case-sensitive; Windows is not

`textures/Density` resolves to `textures/density.png` on a Windows dev machine
and resolves to nothing on Android, iOS and consoles, where it draws an
untextured surface with no error anywhere. The pack index is therefore built
from the real directory listing, in the case the files actually have on disk,
and references are matched against those strings exactly. This class of bug is
invisible locally and is the reason the check exists.

### Pack JSON is not JSON

Bedrock's parser is more permissive than `JSON.parse`, and this pack uses all of
it: `//` comments after array entries, the occasional trailing comma, raw tab
characters inside Molang string literals (`animations/chunk.json`), and a UTF-8
BOM. Read pack files through `tools/lib/jsonc.js`; never `JSON.parse` one
directly, or valid content will be reported as broken.

Parsing is for validation only. **The build copies file bytes verbatim into the
archive** — it never re-serialises a pack file. A compiler that reformatted its
input would silently drop those comments and reflow the compact arrays the model
files are kept in.

### The reference graph the audit resolves

Bedrock never reports a broken reference. A geometry that does not exist, a
texture with the wrong case, a render controller naming a short name the entity
never declared — each one loads quietly and draws nothing. Resolving them
statically is the whole point of `npm run audit`:

| Reference | Defined by |
| --- | --- |
| `geometry.*` | `models/**` — `minecraft:geometry[].description.identifier`, or a legacy `geometry.name` key |
| `animation.*` | `animations/**` — keys of `animations` |
| `controller.animation.*` | `animation_controllers/**` — keys of `animation_controllers` |
| `controller.render.*` | `render_controllers/**` — keys of `render_controllers` |
| particle identifiers | `particles/**` — `particle_effect.description.identifier` |
| material names | `materials/*.material` — the part of a `name:parent` key before the colon |
| `textures/...` | a file under `textures/`, extension resolved by the loader |

Two indirections are worth knowing because they are where the bugs hide:

- **Render controllers do not name assets.** `Geometry.foo`, `Texture.foo` and
  `Material.foo` are lookups into the *referencing entity's* `geometry`,
  `textures` and `materials` maps. The same controller can be valid for one
  entity and broken for another, so it is checked once per reference rather than
  once per file. Values that are Molang rather than a bare short name are
  skipped — they cannot be resolved without running the game.
- **`scripts.animate` entries are short names too**, keys of the entity's own
  `animations` map, not identifiers.

Identifiers the pack references but does not define — vanilla content, and
content from packs commonly loaded alongside this one — live in
`tools/external-refs.json`, where `*` is the only wildcard. Anything that
resolves to nothing and matches nothing there is an error. Adding a pattern is a
claim that something else provides that identifier, so prefer the narrowest
pattern that covers the reference.

### Replacing a vanilla client entity

`entity/player.entity.json` and `entity/armor_stand.entity.json` are copies of
vanilla's files with this pack's content added. A client entity file in a
resource pack **replaces** the vanilla one; the two do not merge. Vanilla's own
animation and render controllers keep asking for the short names vanilla's copy
declared, so every name the copy fails to carry over is a `can't find animation
<name>` in the content log and a vanilla animation that stops playing. This
drifts on its own: Mojang adds a short name in an update and the copy, which
never changed, is suddenly missing it.

`tools/vanilla-baseline.json` records what vanilla declares, and the audit warns
about the difference. Regenerate it with `node tools/refresh-baseline.js`, which
pulls the current files from `Mojang/bedrock-samples` — a manual step, since it
needs the network and is not part of `npm run release`. Run it when a Minecraft
update lands, and act on whatever the audit then reports.

It is a warning rather than an error because dropping a short name can be
deliberate — overriding these files is the whole point of the pack — and because
the baseline tracks whatever vanilla version it was last generated from, which
may be ahead of the client in hand.

### Errors and warnings

An **error** means the pack would ship broken or wrong, and the build refuses to
write an artifact: an unresolvable reference, a duplicate identifier, a file
that does not parse, a `.png` that is not a PNG, a manifest that disagrees with
`package.json`. A **warning** means something is legal but suspicious, and the
build continues: content nothing references, a `scripts.animate` name no
animation map declares, an unrecognised entry in the repository root.

### Manifest rules the build enforces

- `format_version` is `2`.
- Exactly one `resources` module. A `data`, `script` or `client_data` module, a
  `@minecraft/server` dependency, or a `script_eval` capability is an error —
  see the resource-pack-only rule above; the build is where that rule is
  actually held.
- Header and module UUIDs are well-formed and all differ from each other.
- **UUIDs are never regenerated.** The header UUID is the pack's identity: a new
  one makes every world with the pack applied treat it as a different pack and
  quietly drop the old one.
- `header.version`, `header.name` and the `header.description` prefix agree with
  `package.json`.

### Adding a check

Put the check in `tools/lib/validate.js`, decide error or warning by the rule
above, and add a fixture to `tests/validate.test.js` that fails without it. The
fixture helper builds a complete, valid pack on disk and takes a mutation, so a
new case is usually four lines. A check with no failing fixture behind it is not
known to work.

---

## Verify before claiming anything works

`npm run release` runs the whole chain: the parse check, the reference audit,
every test suite, then the bundler. **It must be green before work is reported
as done.** The tooling is plain Node with no dependencies, so there is nothing
to install first.

- `npm run check` — every JSON and `.material` file parses
- `npm run audit` — every reference resolves, no duplicate identifiers, the
  manifest agrees with `package.json`
- `npm test` — the suites (`node --test`)
- `npm run build` — validate, then compile `dist/*.mcpack`

The bundler is not just a zip step: it re-runs the full audit and refuses to
write an artifact if anything fails. A pack that fails the audit will still
install and run — Bedrock does not report broken references — it just draws
nothing, which is why the gate is here and not in-game.

### Cutting a release

Releases are made by hand, locally. There is no CI pipeline that builds or
publishes the pack, and none should be added.

1. `npm run set-version -- <major|minor|fix>` — moves the version everywhere it
   is written.
2. `npm run release` — must be green.
3. Upload `dist/<name>-v<version>.mcpack` to the GitHub release for that
   version, and tag it.

The build prints a `sha256` of the artifact; it is worth pasting into the
release notes, since the build is reproducible and anyone can check it.

Tests run against the **shipped** pack, not a copy of it: `tests/pack.test.js`
loads the working tree and asserts the real content validates, so breaking a
reference fails the suite as well as the audit. Synthetic packs used to test the
validator's own findings are written to `tests/.generated/` (git-ignored) and
left on disk after a failure so they can be opened and looked at.

---

## Working habits

- **Isolate one variable at a time.** Changing two things and then attributing
  the result to one of them has produced wrong diagnoses here more than once.
- **Do not claim a causal link that has not been tested.** A hypothesis stated
  once becomes a fact if it is repeated; say "untested" and name the check that
  would settle it. The user tests in-game and reports back — give them the
  specific thing to look at, and say which observations would *not* prove it.
- **In-game behaviour is not knowable from here.** Rendering, placement,
  collision and font coverage need a live world.
- **Prefer Python patch scripts over shell heredocs** for multi-line source
  edits. `\n` inside a heredoc has repeatedly become a literal newline and
  corrupted JS string literals; em dashes have been mangled the same way. Write
  the script with the Write tool, or anchor on text containing neither.
- **Re-compact JSON after writing it with `json.dumps`**, which explodes short
  numeric arrays across lines. The block and model files are kept compact.

---

##  Compilation and release

Use `npm run release` to compile, test, and bundle the add-on. It will also
increment the version number in `package.json` and `manifest.json`, and create a new release in the `dist/` folder. The release will be named according to the new version number, and will include a summary of the changes made in that version.

Use Typescript to compile the project into a Minecraft .mcpack resource pack format. The compiled resource pack will be located in the `dist/` folder, and can be imported into Minecraft to use the tools provided by the add-on.

---

## Default Vanilla info

The official Bedrock Add-on samples repository is located at: https://github.com/Mojang/bedrock-samples

An unofficial Vanilla resource pack repository is located at: https://github.com/ZtechNetwork/MCBVanillaResourcePack

Community documentation for the Bedrock Add-on system is located at: https://wiki.bedrock.dev/

Official documentation for the Bedrock Add-on system is located at:
* https://learn.microsoft.com/en-us/minecraft/creator/reference/content/vanillalistingsreference/?view=minecraft-bedrock-stable
* https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/?view=minecraft-bedrock-stable