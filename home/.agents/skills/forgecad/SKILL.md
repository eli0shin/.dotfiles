---
name: forgecad
description: ForgeCAD model authoring, editing, debugging, and execution guidance for .forge.js, SVG-import, assembly, and CLI workflows. Use when building or modifying ForgeCAD geometry, structuring multi-file projects, validating scripts, or using ForgeCAD export/render tooling.
forgecad-public: true
---

# ForgeCAD

Author or modify ForgeCAD models, sketches, assemblies, and CLI workflows. Prefer documented primitives, import rules, placement strategies, and CLI commands over inventing new APIs.

## Workflow

1. Identify the artifact: `.forge.js`, SVG asset, or CLI/export task. **For model creation or edits, read `../forgecad-build-model/SKILL.md` first** for the sketch-first workflow, output policy, and completion criteria.
2. For moving parts, load the assembly group and `docs/guides/joint-design.md` before constructing the mechanism.
3. Load only the API sections the task needs from the Source Map. Prefer documented APIs and tested constructions over guesses.
4. For touching or mating parts, read `docs/guides/positioning.md` and use connectors + `matchTo()` for their interface.
5. Validate with `forgecad run <file>` using the project backend. Add `--debug-imports` for import chain issues.
6. Return moving `Assembly` objects directly so runtime controls re-solve kinematics rather than stacking viewport transforms.
7. Build the closed physical artifact. Use viewer cut planes, `explodeView`, hiding, or transparency for explanatory views; add presentation geometry only when requested.

### Import and Composition

- Always include the extension in relative imports: `require("./file.forge.js")` for model files, `require("./helpers.js")` for plain helper modules. Extensionless imports such as `require("./file")` do not resolve; ForgeCAD resolves project imports by exact path.
- Reusable `.forge.js` part files should return builder functions such as `return { buildPart }`; direct-run preview params belong inside `if (require.main === module)`.
- ForgeCAD APIs are injected globals in `.forge.js` files. Use `bom()`, `box()`, `scene()`, `Shape`, etc. directly; never destructure those names from helpers (`const { bom } = require("./bom.js")`). Import helper files under a project-specific name such as `const bomHelpers = require("./bom.js")`.
- For static multi-part models, connectors + `matchTo()` are the default way to assemble touching parts.
- Top-level scripts can return `Assembly` or `SolvedAssembly` directly. Do not call `.toGroup()` just to render an assembly; use it only when you need `ShapeGroup` composition, transforms, or named-child lookup.
- `Import.svgSketch()` loads SVG files (file format loader, not a module import).
- `.placeReference('bottom', [0,0,0])` aligns any built-in anchor to a world coordinate; also works with custom `.withReferences()`.
- Plain `.js` modules hold shared helpers/constants (not model imports).

## Source Map

Paths are relative to this skill directory. Start with core concepts and runtime names; consult other sections only for the features in use.

### 1. Core API

Execution model, colors, coordinate system, primitives, booleans, patterns, imports, parameters, topology, edge queries.

- `docs/API/core/concepts.md`
- `docs/generated/runtime-names.md`
- `docs/guides/manual-parameters.md` — structured user-editable parameter sheets.
- `docs/generated/core.md`

### 2. Static Assembly and Positioning (for any multi-part model)

Axis conventions, winding rules, and placement strategy. If parts should touch in the final model, read this group before writing placement code. Connectors + `matchTo()` are the default for mating interfaces; raw `translate()` and `rotate()` are for free offsets, not assembly contracts.

- `docs/guides/coordinate-system.md`
- `docs/guides/positioning.md`

### 3. Sketch APIs

2D construction, transforms, booleans, paths, on-face sketching, extrusion, anchors, text, regions.

- `docs/generated/sketch.md`

### 4. Curves and Surfacing (for lofts, sweeps, splines)

Smooth curves, Hermite splines, lofted and swept solids. For straps, inlays, guards, brace members, vents, or physical bands that live on a carrier surface, use `Carrier` + `SurfaceBody` surface-member primitives before reaching for `variableSweep`, SDF sculpting, or manual boolean overlap recipes.

- `docs/guides/surface-members.md`
- `docs/generated/curves.md`

### 5. Assemblies and Mechanisms (for joints or kinematics)

Assembly graph, joint types, couplings, validation, and simulation export.

- `docs/generated/assembly.md`

### 6. Sheet Metal (for bent parts, K-factor, flat patterns)

Bend operations, flat pattern unfolding, K-factor configuration.

- `docs/generated/sheet-metal.md`

### 7. Output and Export (for STL/3MF/STEP, BOM, dimensions)

Mesh export, exact geometry export, bill of materials, dimension annotations.

- `docs/generated/output.md`

### 8. Toolbox (fasteners and standard parts)

Parametric bolts, nuts, washers, standard hardware, gears, pipes, and structural profiles.

- `docs/generated/lib.md`
- `docs/generated/wood.md`

### 9. Runtime Viewport APIs (for cut planes, exploded views, hiding, and animation playback)

Viewer-only APIs such as cutPlane, explodeView, render labels, comparison references, and runtime display behavior.

- `docs/generated/viewport.md`

### 10. Recipes and Debugging (for patterns and troubleshooting)

Modeling patterns, debugging tactics, copyable snippets.

- `docs/guides/scene-presentation.md`
- `docs/guides/joint-design.md`

### 11. CLI (for validation/render/export tasks)

Test-run, export pipelines, debug flags.

- `docs/CLI.md`
- `docs/guides/inspection-bundles.md`
- `docs/guides/structural-fea.md`

### SDF Modeling (smooth booleans, TPMS, deformations, fromFunction)

Primitives, smooth booleans, TPMS lattices, twist/bend/displace, morph, custom functions, gotchas. The doc preamble's precision caution applies to every SDF workflow.

- `docs/generated/sdf.md`
