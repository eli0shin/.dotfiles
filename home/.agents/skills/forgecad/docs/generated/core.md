---
skill-group: core
skill-order: 100
---

# Core API

3D primitives, boolean operations, transforms, patterns, imports, and parameters.

## Contents

- [3D Primitives](#3d-primitives)
- [Boolean Operations](#boolean-operations)
- [Edge Features](#edge-features)
- [Patterns & Layout](#patterns-layout)
- [Imports & Composition](#imports-composition)
- [Parameters](#parameters)
- [Grouping & Local Coordinates](#grouping-local-coordinates)
- [Materials & Physical Properties](#materials-physical-properties)
- [Section & Projection](#section-projection)
- [Verification](#verification)
- [Shape](#shape) — Freeform Construction, Appearance, Face Topology, Edge Topology, Transforms, Booleans & Cutting, Features, Placement, Connectors, References, Measurement
- [ShapeSplitResult](#shapesplitresult) — Pieces
- [ShapeSurfaceSplitResult](#shapesurfacesplitresult) — Pieces
- [Transform](#transform)
- [ShapeGroup](#shapegroup) — Children, Transforms, Placement, Connectors, References
- [SurfacePattern](#surfacepattern)
- [Pattern2D](#pattern2d)
- [Pattern2DBuilder](#pattern2dbuilder)
- [Path2DParamValue](#path2dparamvalue)
- [Spline2DParamValue](#spline2dparamvalue)
- [Placement2DParamValue](#placement2dparamvalue)
- [CurveNetBuilder](#curvenetbuilder)
- [MatchEdgeBuilder](#matchedgebuilder)
- [BridgeBuilder](#bridgebuilder)
- [SurfaceComplexBuilder](#surfacecomplexbuilder)
- [ShapeRef](#shaperef)
- [ANCHOR3D_NAMES](#anchor3d-names)
- [verify](#verify)
- [Points](#points)
- [connector](#connector)
- [Import](#import)
- [Wrap](#wrap)
- [PhysicalMaterial](#physicalmaterial)
- [PhysicalProperties](#physicalproperties)

## Functions

### 3D Primitives

#### `box(width: number, depth: number, height: number): Shape` — Create a rectangular box. Centered on XY, base at Z=0.

All ForgeCAD dimensions are millimeters; all angles are degrees (applies to every API, not just `box`).

Extents:

- X: `[-width/2, width/2]`
- Y: `[-depth/2, depth/2]`
- Z: `[0, height]`

This origin convention (centered on XY, base at Z=0) applies to all volumetric primitives that have a base. There is no `center: true` option — recenter with `.translate(0, 0, -height/2)` or `.placeReference('center', [0, 0, 0])`.

For named faces, build from a labeled sketch: `rect(width, depth).labelEdges('s', 'e', 'n', 'w').extrude(height, { labels: { start: 'bottom', end: 'top' } })`.

#### `cylinder(height: number, radius: number, radiusTop?: number, segments?: number): Shape` — Create a cylinder or cone with named faces and edges. Centered on XY, base at Z=0.

Extents:

- X/Y: centered at the origin
- Z: `[0, height]`

`radiusTop` defaults to `radius`. Set `radiusTop` smaller to taper the side, or `0` for a pointy cone. Use `segments` to create regular prisms (for example `6` for a hexagonal prism).

Named faces: `top`, `bottom`, `side` Named edges: `top-rim`, `bottom-rim`

#### `sphere(radius: number, segments?: number): Shape` — Create a sphere centered at the origin.

Extents:

- X: `[-radius, radius]`
- Y: `[-radius, radius]`
- Z: `[-radius, radius]`

Use `segments` for lower-poly approximations.

#### `torus(majorRadius: number, minorRadius: number, segments?: number): Shape` — Create a torus (donut shape) lying in the XY plane. Centered on all axes.

Extents:

- X: `[-(majorRadius + minorRadius), +(majorRadius + minorRadius)]`
- Y: `[-(majorRadius + minorRadius), +(majorRadius + minorRadius)]`
- Z: `[-minorRadius, minorRadius]`

The origin is the center of the ring.

### Boolean Operations

#### `union(...inputs: ShapeOperandInput[]): Shape` — Combine shapes into a single solid (additive boolean).

Accepts individual shapes, or an array of shapes. `union()` returns one solid, so only the first operand's color is preserved in the result. Use `group()` when you want separate child colors or identities.

#### `difference(...inputs: ShapeOperandInput[]): Shape` — Subtract shapes from a base shape (subtractive boolean).

The first shape is the base; all subsequent shapes are subtracted from it. Accepts individual shapes, or an array of shapes.

#### `intersection(...inputs: ShapeOperandInput[]): Shape` — Keep only the overlapping volume of the input shapes (intersection boolean).

Requires at least two shapes. Accepts individual shapes, or an array.

### Edge Features

#### `fillet(shape: Shape, radius: number, edges?: EdgeSelector, segments?: number): Shape` — Apply experimental fillets (rounded edges) to one or more edges of a shape.

**Experimental**: edge finishes (fillet and chamfer) are backend-sensitive. The Manifold backend is known to produce incorrect results for some edge-finish cases, and the OCCT backend can be very slow, especially with broad edge selections. Prefer profile-level rounding where the design allows (`sketch.filletCorners(radius)` before extruding — exact and fast); otherwise use targeted edge selectors and inspect the result before treating it as production-ready geometry.

Edge selections compile into backend operations; unsupported selections fail as explicit kernel gaps instead of using TypeScript geometry fallbacks.

The `edges` parameter is flexible:

- Omit to fillet **all** sharp edges
- Pass an `EdgeQuery` for an inline filter (most common)
- Pass an `EdgeSegment` or `EdgeSegment[]` from `selectEdges()` for pre-selected edges
- Pass a tracked `EdgeRef` from `shape.edge('vert-br')` (vertical edges of `box()` / [`Rectangle2D`](/docs/sketch#rectangle2d) extrusions) — this takes the **exact** compiler-owned path, not the mesh-approximate one

Throws if no edges match the selection, or if `radius` is not a positive finite number.

Selectorless (all-edges) calls draw from a per-run broad edge-feature budget. Exceeding it throws — except in live preview, which skips the finish with a warning for responsiveness. Explicit edge selectors are never budgeted; `FORGECAD_BROAD_EDGE_FEATURE_BUDGET` / `FORGECAD_ALLOW_BROAD_EDGE_FEATURES=1` raise or lift the budget.

```ts
// Fillet all edges
fillet(myShape, 2)

// Fillet only top convex edges
fillet(myShape, 1.5, { atZ: 20, convex: true })

// Fillet vertical edges selected beforehand
const edges = selectEdges(myShape, { parallel: [0, 0, 1] })
fillet(myShape, 3, edges)

// Exact compiler-owned fillet on a tracked box edge
const base = box(50, 50, 20)
fillet(base, 5, base.edge('vert-br'))
```

#### `chamfer(shape: Shape, size: number, edges?: EdgeSelector): Shape` — Apply experimental chamfers (beveled edges) to one or more edges of a shape.

**Experimental**: same backend caveats as `fillet` — Manifold may be incorrect for some edge-finish cases, OCCT can be very slow on broad selections; prefer profile-level rounding or targeted selectors and inspect the result.

Produces a 45° bevel at the specified `size` (distance from edge). Edge selections compile into backend operations; unsupported selections fail as explicit kernel gaps instead of using TypeScript geometry fallbacks.

Selectorless (all-edges) calls draw from a per-run broad edge-feature budget. Exceeding it throws — except in live preview, which skips the finish with a warning for responsiveness. Explicit edge selectors are never budgeted; `FORGECAD_BROAD_EDGE_FEATURE_BUDGET` / `FORGECAD_ALLOW_BROAD_EDGE_FEATURES=1` raise or lift the budget.

The `edges` parameter accepts the same options as `fillet()`: inline `EdgeQuery`, pre-selected `EdgeSegment`/`EdgeSegment[]`, a tracked `EdgeRef` from `shape.edge('vert-br')` (exact compiler-owned path), or `undefined` (all sharp edges).

```ts
// Chamfer all edges
chamfer(myShape, 1)

// Chamfer only vertical edges
chamfer(myShape, 2, { parallel: [0, 0, 1] })

// Exact compiler-owned chamfer on a tracked box edge
const base = box(50, 50, 20)
chamfer(base, 3, base.edge('vert-br'))
```

#### `draft(shape: Shape, angleDeg: number, pullDirection?: Vec3, neutralPlaneOffset?: number): Shape` — Apply a draft angle (taper) to vertical faces for mold extraction.

Adds a taper angle to the vertical faces of a solid so that it can be extracted from a mold. The neutral plane is the Z position where the draft angle is zero — faces above and below are tapered symmetrically. Typical values for injection molding are 1–5°.

SDF, Manifold, and Truck lower supported vertical-prism solids with Z-axis pull directions to a tapered loft. OCCT uses its native draft operation when available.

```ts
// Add 3° draft to a box for injection molding
draft(myBox, 3)

// Draft with custom pull direction and neutral plane
draft(myShape, 2, [0, 0, 1], 10)
```

#### `offsetSolid(shape: Shape, thickness: number): Shape` — Uniformly offset all surfaces of a solid inward or outward.

Unlike `shell()`, which hollows a solid by removing one face, `offsetSolid()` produces a new solid whose every surface is shifted by `thickness`. Positive values grow the shape outward; negative values shrink it inward.

Requires the OCCT backend. Throws on Manifold.

```ts
// Grow a box outward by 1mm on all sides
offsetSolid(myBox, 1)

// Shrink a shape inward by 0.5mm
offsetSolid(myShape, -0.5)
```

### Patterns & Layout

#### `circularLayout(count: number, radius: number, options?: CircularLayoutOptions): LayoutPoint[]` — Compute evenly-spaced positions around a circle.

Eliminates the most common trig pattern in CAD scripts:

```js
// Before — manual trig
for (let i = 0; i < 12; i++) {
  const angle = i * 30 * Math.PI / 180;
  markers.push(marker.translate(r * Math.cos(angle), r * Math.sin(angle), 0));
}

// After — declarative
for (const {x, y} of circularLayout(12, r)) {
  markers.push(marker.translate(x, y, 0));
}
```

**`CircularLayoutOptions`**
- `startDeg?: number` — Angle of the first element in degrees (default: 0 = +X axis).
- `centerX?: number` — Center X coordinate (default: 0).
- `centerY?: number` — Center Y coordinate (default: 0).

`LayoutPoint`: `{ x: number, y: number }`

#### `polygonVertices(sides: number, radius: number, options?: PolygonVerticesOptions): LayoutPoint[]` — Compute the vertex positions of a regular polygon.

Default orientation places the first vertex at the top (90 degrees), matching the convention used by [`ngon()`](/docs/sketch#ngon).

Eliminates manual Math.sqrt(3) for triangles, pentagon vertex math, etc:

```js
// Before — manual equilateral triangle
const v1 = [center.x - r/2, center.y + r * Math.sqrt(3)/2];
const v2 = [center.x - r/2, center.y - r * Math.sqrt(3)/2];
const v3 = [center.x + r, center.y];

// After — declarative
const [v1, v2, v3] = polygonVertices(3, r);
```

**`PolygonVerticesOptions`**
- `startDeg?: number` — Angle of the first vertex in degrees (default: 90 = top).
- `centerX?: number` — Center X coordinate (default: 0).
- `centerY?: number` — Center Y coordinate (default: 0).

#### `linearPattern(shape: Shape, count: number, dx: number, dy: number, dz?: number): Shape` — Repeat a shape in a linear pattern along a direction vector and union the copies.

Creates `count` copies of `shape`, each offset by `(dx*i, dy*i, dz*i)` from the original. All copies are unioned into a single `Shape`. Distinct compiler ownership is assigned to each copy so face identity via owner-scoped canonical queries still works post-merge.

```ts
// 5 cylinders, 20mm apart along X
linearPattern(cylinder(10, 3), 5, 20, 0)
```

#### `circularPattern(shape: Shape, count: number, centerXOrOpts?: number | CircularPatternOptions, centerY?: number): Shape` — Repeat a shape in a circular pattern around an axis and union the copies.

Distributes `count` copies evenly around the rotation axis (360° / count per step). All copies are unioned into a single `Shape`. Distinct compiler ownership is assigned to each copy — post-merge face identity via owner-scoped canonical queries still works for pattern descendants.

Two calling conventions:

- **Simple** (Z axis): `circularPattern(shape, 6)` or `circularPattern(shape, 6, centerX, centerY)`
- **Advanced** (arbitrary axis): `circularPattern(shape, 6, { axis, origin })`

```ts
// 8 holes evenly spaced around origin
circularPattern(cylinder(12, 4).translate(30, 0, -1), 8)

// Circular pattern around X axis
circularPattern(myFeature, 4, { axis: [1, 0, 0], origin: [0, 0, 50] })
```

**`CircularPatternOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `centerX?` | `number` | Center X of the rotation (default: 0). Used when the rotation axis is Z. |
| `centerY?` | `number` | Center Y of the rotation (default: 0). Used when the rotation axis is Z. |
| `axis?` | `Vec3` | Rotation axis direction (default: [0, 0, 1] = Z axis). |
| `origin?` | `Vec3` | Pivot point for the rotation (default: [0, 0, 0]). Overrides centerX/centerY when set. |

#### `linearPattern2d(sketch: Sketch, count: number, dx: number, dy?: number): Sketch` — Repeat a 2D sketch in a linear pattern and union the copies.

#### `circularPattern2d(sketch: Sketch, count: number, centerXOrOpts?: number | { centerX?: number; centerY?: number; startDeg?: number; }, centerY?: number): Sketch` — Repeat a 2D sketch in a circular pattern around a center point and union the copies.

#### `mirrorCopy(shape: Shape, normal: Vec3): Shape` — Mirror a shape across a plane and union the mirror with the original.

The mirror plane passes through the origin and is defined by its normal vector. The mirrored copy is unioned with the original to produce a single symmetric Shape.

```ts
// Mirror across the YZ plane (X=0)
mirrorCopy(box(50, 30, 10), [1, 0, 0])
```

#### `selectEdges(shape: Shape, query?: EdgeQuery): EdgeSegment[]` — Select all edges from a shape that match the given query.

Uses the active kernel's native topology query when available (Truck), otherwise extracts sharp edges from the mesh (dihedral angle > 1°), applies all filters in the query, and returns the matching `EdgeSegment[]`. When `near` is specified the results are sorted closest-first.

Works on any shape — primitives, booleans, shells, and imported meshes. Use this when tracked topology is unavailable (e.g. after a difference or on imported geometry). For simpler cases, pass an `EdgeQuery` directly to `fillet()` or `chamfer()` instead of calling `selectEdges` separately.

```ts
// Fillet all top edges of a box
const topEdges = selectEdges(part, { atZ: 20, perpendicular: [0, 0, 1] });
let result = part;
for (const edge of coalesceEdges(topEdges)) {
  result = fillet(result, 2, edge);
}
```

**`EdgeQuery`**

| Option | Type | Description |
|--------|------|-------------|
| `near?` | `Vec3` | Sort by proximity to this point (closest first). When used with `selectEdge`, picks the closest match. |
| `parallel?` | `Vec3` | Filter: edge direction approximately parallel to this vector. |
| `perpendicular?` | `Vec3` | Filter: edge direction approximately perpendicular to this vector. |
| `convex?` | `boolean` | Filter: only convex (outside corner) edges. |
| `concave?` | `boolean` | Filter: only concave (inside corner) edges. |
| `minAngle?` | `number` | Filter: minimum dihedral angle in degrees. |
| `maxAngle?` | `number` | Filter: maximum dihedral angle in degrees. |
| `minLength?` | `number` | Filter: minimum edge length. |
| `maxLength?` | `number` | Filter: maximum edge length. |
| `within?` | `BoundingRegion` | Filter: edge midpoint must be within this bounding region. |
| `atZ?` | `number` | Shorthand: edge midpoint Z is approximately this value within `tolerance`. |
| `tolerance?` | `number` | Position tolerance for approximate matches. Used by `atZ` and `near`. Default: `1.0`. |
| `angleTolerance?` | `number` | Angular tolerance in degrees for `parallel`/`perpendicular` filters. Default: `10`. |

`BoundingRegion`: `{ xMin?: number, xMax?: number, yMin?: number, yMax?: number, zMin?: number, zMax?: number }`

**`EdgeSegment`**

| Option | Type | Description |
|--------|------|-------------|
| `index` | `number` | Stable index within the extraction (deterministic for a given mesh). |
| `direction` | `Vec3` | Normalized direction from start → end. |
| `dihedralAngle` | `number` | Dihedral angle in degrees (0 = coplanar, 180 = knife edge). |
| `convex` | `boolean` | true = outside corner (convex), false = inside corner (concave). |
| `normalA` | `Vec3` | Normal of first adjacent face. |
| `normalB` | `Vec3` | Normal of second adjacent face (same as normalA for boundary edges). |
| `boundary` | `boolean` | true if this is a boundary (unmatched) edge — unusual for closed solids. |

Also: `start: Vec3`, `end: Vec3`, `midpoint: Vec3`, `length: number`.

#### `selectEdge(shape: Shape, query?: EdgeQuery): EdgeSegment` — Select the single best-matching edge from a shape.

When `near` is specified, returns the edge whose midpoint is closest to that point. Otherwise returns the first matching edge in mesh order. Throws if no edges match the query — useful as a guard when you expect exactly one result.

```ts
// Chamfer one specific edge near a known point
const bottomEdge = selectEdge(part, { near: [25, 0, 0], atZ: 0 });
result = chamfer(result, 1.5, bottomEdge);
```

#### `coalesceEdges(segments: EdgeSegment[], tolerance?: number): EdgeSegment[]` — Merge collinear edge segments into longer logical edges.

Tessellation often splits one geometric edge into multiple short segments. `coalesceEdges` groups adjacent collinear segments and merges each group into a single `EdgeSegment` spanning the full extent. This is usually needed before passing edges to `fillet()` or `chamfer()` on non-primitive shapes.

The `tolerance` controls the maximum perpendicular distance from collinearity before two segments are considered non-collinear. Default: `0.01`.

```ts
const topEdges = selectEdges(part, { atZ: 20 });
for (const edge of coalesceEdges(topEdges)) {
  result = fillet(result, 2, edge);
}
```

### Imports & Composition

#### `require(path: string): any` — Import a ForgeCAD or helper module. Returns the file's returned value.

When importing a `.forge.js` file, return values are passed through exactly as the script returns them, except for unsolved assemblies: a returned [`Assembly`](/docs/assembly#assembly) is wrapped as an [`ImportedAssembly`](/docs/assembly#importedassembly), preserving `solve(state)` and `mergeInto()` across file boundaries. A returned [`SolvedAssembly`](/docs/assembly#solvedassembly) stays a [`SolvedAssembly`](/docs/assembly#solvedassembly).

**Script return contract:** a `.forge.js` script should return one of three shapes: a single renderable (Shape, ShapeGroup, Sketch, SdfShape, Assembly), an array of renderables or named descriptors (`{ name, shape|sketch|group }`) for previews and multi-object display, or a module interface object. Reusable part files should return builders such as `return { buildBracket }`; files that already build useful geometry may return `{ shape, connectors, boltPattern }`. When a script runs directly, renderable entries of a plain object are rendered under their key names and non-renderable entries are skipped.

**Assembly return contract**

| `.forge.js` return value | `require()` result |
|---|---|
| `Assembly` | `ImportedAssembly` |
| `SolvedAssembly` | `SolvedAssembly` |

[`ImportedAssembly`](/docs/assembly#importedassembly) exposes default-pose helpers such as `getPart()`, `collisionReport()`, and `minClearance()`. Use `solve(state)` first when inspecting a non-default pose.

**Path rule:** Always include the file extension in relative imports: use `require("./part.forge.js")` for model files and `require("./helpers.js")` for plain helper modules. ForgeCAD does not apply Node-style extension inference, so `require("./part")` will not find `part.forge.js` or `part.js`.

**Multi-file assembly pattern** — the assembly owns params and passes ordinary props to child builders:

```js
// assembly.forge.js — owns cross-cutting params, passes to parts
const wall = param("Wall", 3);
const baseH = param("Base Height", 20);

const mountModule = require('./motor-mount.forge.js');
const baseModule = require('./base-body.forge.js');

const mount = mountModule.buildMount({ wall });
const base = baseModule.buildBase({ wall, height: baseH });
```

**Builder result pattern** — parts publish interface data alongside geometry:

```js
// motor-mount.forge.js
function buildMount({ wall }) {
  const shape = box(80, 40, wall);
  return { shape, boltPattern: { dia: 5.3, positions: [[-25, 0], [25, 0]] } };
}

// base-body.forge.js
const mount = require('./motor-mount.forge.js');
const built = mount.buildMount({ wall: 3 });
built.boltPattern  // access interface data
built.shape        // access geometry
```

**Forge-aware builder module pattern** — use `.forge.js` modules for reusable sketch, profile, shape, or assembly builders that need ForgeCAD runtime APIs:

```js
// profiles.forge.js
function wheelProfile() {
  return circle2d(40).subtract(circle2d(18));
}

if (require.main === module) {
  return [{ name: 'Wheel profile', sketch: wheelProfile() }];
}

return { wheelProfile };

// main.forge.js
const profiles = require('./profiles.forge.js');
const wheel = profiles.wheelProfile().extrude(8);
```

Keep returned builders pure over top-level constants or explicit function arguments. Put preview-only `param()` values inside `if (require.main === module)` so parent assemblies stay in charge of design parameters. Use plain `.js` modules only for pure constants, tables, math helpers, and formatting code that does not construct ForgeCAD geometry.

**Entry detection (Node semantics):** `require.main` is the entry script's module object, so `require.main === module` is true only in the file being run directly. Part files use it to build standalone preview geometry only when opened directly — importers then skip that work entirely:

```js
// part.forge.js
function bracket() { ... }
if (require.main === module) {
  return bracket({ width: param('Width', 80), height: param('Height', 40) });
}
return { bracket };
```

### Parameters

#### `Param.anchor: { ... }` — Viewport anchor builders for spatial parameter editing.

Anchors are metadata only: they do not change geometry. The editor uses them to show clickable parameter pins and manual-editing sheets in the 3D viewport. Use point anchors for scalar/text/list parameters and sheet anchors for `path2d`, [`spline2d`](/docs/curves#spline2d), and `placement2d` editors.

A sheet anchor's origin is a world/model-space point. Its plane selects how the 2D editor coordinates map into the viewport:

- `sheetOnXY([x, y, z])`: editor x/y map to world X/Y at fixed Z.
- `sheetOnXZ([x, y, z])`: editor x/y map to world X/Z at fixed Y.
- `sheetOnYZ([x, y, z])`: editor x/y map to world Y/Z at fixed X.

Omitting `anchor` still registers the parameter in the parameter panel; it just will not create a viewport pin/sheet.

`ParamAnchorOptions`: `{ label?: string, color?: string }`

#### `Param.number(name: string, defaultValue: number, opts?: NumberParamOptions): number` — Declare a numeric parameter that renders as a slider in the UI.

Each call registers a slider control. When the user moves the slider the entire script re-executes with the new value. The `name` string is the UI label and the CLI `--param` key.

Default range rules when options are omitted:

- `min` defaults to `0`
- `max` defaults to `defaultValue * 4`
- `step` is auto-calculated: `1` for integer params, `0.1` for ranges ≤ 100, `1` for larger ranges

The `unit` option is cosmetic only — no conversion is performed. Use `integer: true` for counts, sides, quantities (rounds to whole numbers; step defaults to `1`).

```ts
const width = Param.number("Width", 50);
const angle = Param.number("Angle", 45, { min: 0, max: 180, unit: "°" });
const sides = Param.number("Sides", 6, { min: 3, max: 12, integer: true });
```

CLI overrides use the parameter name:

```bash
forgecad run model.forge.js --param "Wall Thickness=3"
```

Also available as the shorthand alias `param()`.

`ParamAnchorableOptions`: `{ anchor?: ParamAnchorDef }`

`NumberParamOptions`: `{ min?: number, max?: number, step?: number, unit?: string, integer?: boolean, reverse?: boolean }`

#### `Param.string(name: string, defaultValue: string, opts?: StringParamOptions): string` — Declare a string parameter that renders as a text input in the UI.

String parameters let users type free-form text — labels, names, inscriptions, file paths, etc.

```ts
const label = Param.string("Label", "Hello World");
const name  = Param.string("Name", "Part-001", { maxLength: 20 });
```

Only available as `Param.string()` — no standalone alias.

`StringParamOptions`: `{ maxLength?: number }`

#### `Param.bool(name: string, defaultValue: boolean, opts?: ParamAnchorableOptions): boolean` — Declare a boolean parameter that renders as a checkbox in the UI.

Internally stored as `0`/`1` for CLI overrides. Pass `1` for true and `0` for false.

```ts
const showHoles = Param.bool("Show Holes", true);
if (showHoles) return difference(plate, cylinder(10, 5).translate(50, 30, 0));
return plate;
```

#### `Param.choice(name: string, defaultValue: string, choices: string[], opts?: ParamAnchorableOptions): string` — Declare a choice parameter that renders as a dropdown in the UI.

`defaultValue` must exactly match one entry in `choices`. Returns the selected string label. Prefer `Param.choice` over `Param.number` when a slider would hide intent — named choices like `"wok"` are self-describing.

CLI overrides may be passed as the choice label string (preferred) or as a numeric index.

```ts
const panStyle = Param.choice("Pan Style", "frying-pan", ["frying-pan", "saute-pan", "wok"]);
if (panStyle === "wok") return buildWok();
```

Override via CLI:

```bash
forgecad run model.forge.js --param "Pan Style=wok"
```

#### `Param.list<T extends Record<string, number | boolean | string>>(name: string, defaultItems: T[], opts: { ... }): T[]` — Declare a list parameter — an array of struct items with per-field UI controls.

Each item in the list is a struct whose fields each render as their own control (slider, checkbox, or dropdown). The user can add/remove rows up to `minItems`/`maxItems` bounds.

Field types:

- Boolean fields (`boolean: true` in field defs) return as `boolean`
- Choice fields (`choices: [...]` in field defs) return as `string`
- All other fields return as `number`

`ListParamFieldDef`: `{ min?: number, max?: number, step?: number, unit?: string, integer?: boolean, boolean?: boolean, choices?: string[] }`

#### `Param.path2d(name: string, defaultPoints: Path2DPointInput[], opts?: Path2DParamOptions): Path2DParamValue` — Declare an editable 2D path parameter.

Use this for hand-shaped 2D profile data: plate outlines, slice profiles, stroke centerlines, and sweep rails. The returned value keeps the model code deterministic while the editor can render a drag-handle path UI.

Override keys use the same explicit row-field form as list params: `Path Name[0].x`, `Path Name[0].y`, and `Path Name.__count__`.

```ts
const outline = Param.path2d("Bracket Outline", [
  [-40, -20],
  [40, -20],
  [36, 24],
  [-30, 28],
], {
  closed: true,
  anchor: Param.anchor.sheetOnXY([0, 0, 8], { label: "Bracket outline" }),
});

return outline.toSketch().filletCorners(4).extrude(5);
```

**`Path2DParamOptions`** extends ParamAnchorableOptions: `closed?: boolean`, `minPoints?: number`, `maxPoints?: number`, `x?: Partial<Path2DParamAxisDef>`, `y?: Partial<Path2DParamAxisDef>`, `unit?: string`

**`Path2DParamAxisDef`**
- `min: number` — Initial editor-frame minimum. Points may move outside this range on the infinite canvas.
- `max: number` — Initial editor-frame maximum. Points may move outside this range on the infinite canvas.
- Also: `step: number`.

#### `Param.spline2d(name: string, defaultPoints: Spline2DPointInput[], opts?: Spline2DParamOptions): Spline2DParamValue` — Declare an editable 2D spline parameter.

Use this when the model wants hand-shaped smooth curve data instead of a numeric table: handle spines, bowl station curves, sweep rails, and class-A guide profiles. Each node stores `g`, a continuity intent:

- `"G0"` starts/ends a hard curve segment at that point
- `"G1"` keeps the point in a tangent-smooth run
- `"G2"` keeps the point in a curvature-smooth cubic run

Override keys use explicit row-field form: `Curve Name[0].x`, `Curve Name[0].y`, `Curve Name[0].g`, and `Curve Name.__count__`.

```ts
const spine = Param.spline2d("Handle Spine", [
  { x: 0, y: 0, g: "G2" },
  { x: 35, y: 8, g: "G2" },
  { x: 80, y: 2, g: "G1" },
], {
  anchor: Param.anchor.sheetOnXZ([0, -18, 0], { label: "Side-view spine" }),
});

return sweep(circle2d(2), spine.toCurveOnXZ());
```

**`Spline2DParamOptions`** extends ParamAnchorableOptions: `closed?: boolean`, `degree?: number`, `defaultContinuity?: Spline2DContinuity`, `minPoints?: number`, `maxPoints?: number`, `x?: Partial<Path2DParamAxisDef>`, `y?: Partial<Path2DParamAxisDef>`, `unit?: string`

#### `Param.placement2d(name: string, spec: Placement2DParamOptions): Placement2DParamValue` — Declare an editable 2D placement sheet parameter.

Use this when the user should arrange named model roles rather than draw geometry: batteries inside an enclosure, rooms across floors, controls on a panel, robot modules on a chassis, or other semantic blockouts.

The script declares stable item IDs, footprints, optional rectangular zones, and interaction rules. The returned value exposes named placements as data; the model code decides what those placements mean geometrically.

Override keys are item-ID based: `Layout.battery.x`, `Layout.battery.y`, `Layout.battery.angle`, and `Layout.battery.zone`.

```ts
const layout = Param.placement2d("Internal Layout", {
  frame: { size: [120, 80] },
  items: [
    { id: "battery", footprint: { type: "rect", size: [42, 24] }, at: [-25, 0] },
    { id: "speaker", footprint: { type: "circle", radius: 12 }, at: [32, 8] },
  ],
  rules: { bounds: "prevent", collisions: "warn", snap: 1 },
  anchor: Param.anchor.sheetOnXY([0, 0, 12], { label: "Internal layout" }),
});

const battery = layout.item("battery");
const batteryPocket = box(42, 24, 6).translate(battery.x, battery.y, 3);
```

**`Placement2DParamOptions`** extends ParamAnchorableOptions: `frame?: Placement2DFrameInput`, `zones?: Placement2DZoneInput[]`, `items: Placement2DItemInput[]`, `rules?: Partial<Placement2DRulesDef>`, `unit?: string`

`Placement2DFrameInput`: `{ width?: number, height?: number, size?: Vec2, center?: Placement2DPointInput, at?: Placement2DPointInput }`

`Placement2DZoneInput`: `{ id: string, label?: string, frame?: Placement2DFrameInput }`

**`Placement2DItemInput`**: `id: string`, `label?: string`, `footprint: Placement2DFootprintInput`, `at?: Placement2DPointInput`, `center?: Placement2DPointInput`, `angle?: number`, `zone?: string`, `locked?: boolean`

`Placement2DRulesDef`: `{ bounds: Placement2DRuleMode, collisions: Placement2DRuleMode, snap: number }`

### Grouping & Local Coordinates

#### `group(...items: GroupInput[]): ShapeGroup` — Group multiple shapes/sketches for joint transforms without merging into a single mesh.

Unlike union(), child colors and individual identities are preserved. Children can be plain shapes, named descriptors ({ name, shape/sketch/group }), or nested groups. The returned ShapeGroup supports all Shape transforms (translate, rotate, etc.).

Named descriptors can include `tags` for viewport organization. Tags do not affect geometry; they let the command palette hide, show only, or focus all objects with the same tag.

**Local coordinate pattern:** Build child parts at the origin (local coordinates), then group and translate once to place the whole assembly. This eliminates the error-prone pattern of manually adding parent offsets to every sub-part.

```js
const body = roundedBox(100, 20, 32, 4);
const panel = box(98, 2, 18).translate(0, -12, 4);
const louver = box(88, 2, 6).translate(0, -14, -11);
const indoorUnit = group(
  { name: 'Body', shape: body },
  { name: 'Panel', tags: 'cover', shape: panel },
  { name: 'Louver', tags: ['cover', 'moving'], shape: louver },
).translate(0, -18, 70);
```

### Materials & Physical Properties

#### `PhysicalMaterial.define(name: string, options: PhysicalMaterialOptions): PhysicalMaterialDef` — Define a custom engineering material using `densityKgM3` or `density` plus `densityUnit`.

**`PhysicalMaterialOptions`**: `id?: string`, `grade?: string`, `designation?: string`, `densityKgM3?: number`, `density?: number`, `densityUnit?: PhysicalMaterialDensityUnit | string`, `appearance?: PhysicalMaterialAppearanceHints`, `notes?: string | string[]`

`PhysicalMaterialAppearanceHints`: `{ color?: string, material?: ShapeMaterialProps }`

**`ShapeMaterialProps`**

| Option | Type | Description |
|--------|------|-------------|
| `metalness?` | `number` | Metalness factor (0 = dielectric, 1 = metal). Default: 0.05 |
| `roughness?` | `number` | Roughness factor (0 = mirror, 1 = fully diffuse). Default: 0.35 |
| `emissive?` | `string` | Emissive glow color (hex string, e.g. "#ff6b35"). |
| `emissiveIntensity?` | `number` | Emissive intensity multiplier. Default: 1 |
| `opacity?` | `number` | Opacity (0 = fully transparent, 1 = fully opaque). Default: 1 |
| `wireframe?` | `boolean` | Render as wireframe. Default: false |
| `clearcoat?` | `number` | Clearcoat intensity (0–1). Default: 0.1 |
| `clearcoatRoughness?` | `number` | Clearcoat roughness (0–1). Default: 0.4 |
| `transmission?` | `number` | Glass/translucency transmission factor (0–1). Renderer support depends on target. |
| `ior?` | `number` | Index of refraction for transmissive materials. Typical glass is ~1.45. |
| `thickness?` | `number` | Approximate transmissive volume thickness in model units. |
| `specularIntensity?` | `number` | Specular highlight intensity (0–1). |
| `specularColor?` | `string` | Specular highlight tint. |
| `reflectivity?` | `number` | Reflection strength for supported renderers (0–1). |
| `texture?` | `{ image: string; projection: UvProjectionSpec; ...` | Projected bitmap texture set by `Shape.wrapTexture`. `image` is a self-contained `data:` URI; `projection` maps each vertex's final world position to (u,v) in the shader, so the texture survives transforms and boolean cuts. `imageWidth`/`imageHeight` are the intrinsic pixel dimensions. |

**`PhysicalMaterialDef`**: `kind: "physical-material"`, `id: string`, `name: string`, `grade?: string`, `designation?: string`, `densityKgM3: number`, `densitySource: { value: number; unit: PhysicalMaterialDensityUnit; }`, `appearance?: PhysicalMaterialAppearanceHints`, `notes: string[]`

#### `PhysicalMaterial.get: (id: string) => PhysicalMaterialDef` — Resolve a built-in material preset by id, such as `aluminum-6061-t6` or `mild-steel`.

#### `PhysicalMaterial.presets` — Common engineering material presets for early mass and physical-property reports.

- `PhysicalMaterial.presets.aluminum6061T6(): PhysicalMaterialDef` — 6061-T6 aluminum preset with density 2700 kg/m^3.
- `PhysicalMaterial.presets.mildSteel(): PhysicalMaterialDef` — Common mild steel preset with density 7850 kg/m^3.
- `PhysicalMaterial.presets.astmA36Steel(): PhysicalMaterialDef` — ASTM A36 mild structural steel preset with density 7850 kg/m^3.

#### `PhysicalProperties.approximate(target: Shape | ShapeGroup, options?: PhysicalPropertiesOptions): PhysicalPropertiesReport` — Compute a mesh-tessellated physical-property report from assigned materials.

**`PhysicalPropertiesOptions`**: `material?: PhysicalMaterialInput`, `densityKgM3?: number`, `density?: number`, `densityUnit?: PhysicalMaterialDensityUnit | string`, `targetName?: string`

**`PhysicalPropertiesReport`**: `total: PhysicalPropertiesSummary`, `components: PhysicalPropertiesComponentReport[]`, `bodies: PhysicalPropertiesBodyReport[]`, `units: PhysicalPropertiesUnits`, `exactness: { kind: "mesh-tessellated"; method: "triangulated-mesh-integration"; backend: GeometryInfo["backend"]; representation: GeometryInfo["representation"]; fidelity: GeometryInfo["fidelity"]; triangleCount: number; assumptions: string[]; }`, `frame: "model"`, `assumptions: string[]`, `diagnostics: string[]`

**`PhysicalPropertiesSummary`**: `volumeMm3: number`, `surfaceAreaMm2: number`, `massKg: number`, `densityKgM3: number`, `centerOfMassMm: Vec3`, `inertiaTensorKgM2: InertiaTensor`, `principalMomentsKgM2: Vec3`, `principalAxes: [ Vec3, Vec3, Vec3 ]`, `radiusOfGyrationM: Vec3`, `boundingBoxMm: BoundingBox`

`InertiaTensor`: `{ ixx: number, iyy: number, izz: number, ixy: number, ixz: number, iyz: number }`

`BoundingBox`: `{ minMm: Vec3, maxMm: Vec3, sizeMm: Vec3 }`

**`PhysicalPropertiesBodyReport`** extends PhysicalPropertiesSummary: `name: string`, `path: string[]`, `material: PhysicalMaterialDef`, `materialSource: "shape" | "report-override" | "density-override"`, `geometryInfo: GeometryInfo`, `triangleCount: number`, `bodyCount: number`, `identity: { kind: "shape"; limitation?: string; }`

**`GeometryInfo`**: `backend: GeometryBackend`, `representation: GeometryRepresentation`, `fidelity: GeometryFidelity`, `topology: GeometryTopology`, `sources: GeometrySource[]`

**`PhysicalPropertiesUnits`**: `length: "mm"`, `volume: "mm^3"`, `surfaceArea: "mm^2"`, `mass: "kg"`, `density: "kg/m^3"`, `inertia: "kg*m^2"`, `radiusOfGyration: "m"`

#### `PhysicalProperties.exact(_target: Shape | ShapeGroup, _options?: PhysicalPropertiesOptions): PhysicalPropertiesReport` — Request an exact BREP physical-property report; currently throws instead of falling back to mesh approximation.

### Section & Projection

#### `intersectWithPlane(shape: Shape, plane: PlaneSpec): Sketch` — Cross-section: slice a 3D shape with a plane and return the intersection as a 2D Sketch.

#### `faceProfile(shape: Shape, face: FaceSelector): Sketch` — Extract the boundary profile of a named face as a 2D sketch.

The result is returned in the face's local 2D coordinate system, making it convenient for offsets, pocket profiles, or follow-up sketch operations driven by an existing face.

#### `projectToPlane(shape: Shape, plane: PlaneSpec): Sketch` — Orthographically project a 3D shape onto a plane and return the silhouette as a 2D Sketch.

### Verification

#### `verify.that(label: string, check: () => boolean, message?: string): void` — Custom predicate check.

#### `verify.equal(label: string, actual: number, expected: number, tolerance?: number, message?: string): void` — Check that two numbers are approximately equal (within tolerance).

#### `verify.notEqual(label: string, actual: number, unexpected: number, tolerance?: number, message?: string): void` — Check that two numbers are NOT equal (differ by more than tolerance).

#### `verify.greaterThan(label: string, actual: number, min: number, message?: string): void` — Check that actual > min.

#### `verify.lessThan(label: string, actual: number, max: number, message?: string): void` — Check that actual < max.

#### `verify.inRange(label: string, actual: number, min: number, max: number, message?: string): void` — Check that min <= actual <= max.

#### `verify.centersCoincide(label: string, a: ShapeLike, b: ShapeLike, tolerance?: number): void` — Check that the bounding-box centers of two shapes coincide within tolerance (mm).

`ShapeLike`: `{ min: number[], max: number[] }`

#### `verify.connectorDistance(label: string, target: ConnectorDistanceLike, connectorA: string, connectorB: string, expected?: number, tolerance?: number): void` — Check the distance between two named connectors on a shape or group.

Use this when connectors + `matchTo()` define a static assembly interface. It proves the mate at runtime, unlike a plain source-level connector declaration. The common case is `expected = 0`, meaning the two connector origins should coincide after placement.

```ts
verify.connectorDistance("leg is seated", bench, "Rail.leg_0", "Leg0.head", 0, 0.01);
```

#### `verify.physicalComponentCount(label: string, expected: number): void` — Declare the expected physical connectivity component count for the returned visible model.

Use this for generated mechanical models that should have a clear component graph: one connected fixture, a purchased part plus a removable cartridge, a root assembly plus named intentional ghosts, and so on. `forgecad inspect mechanical-integrity` resolves the returned visible objects with the same physical-connectivity analysis used in the quality gate and fails if the actual component count differs.

This catches the common generated-CAD failure where a script returns a visually plausible artifact but the handle, screw, washer, cover, or terminal block is actually a separate island.

```ts
verify.physicalComponentCount("vise is one connected installed assembly", 1);
```

#### `verify.intentionalOverlap(label: string, a: ShapeLike, b: ShapeLike, reason: string): void` — Declare that two visible objects intentionally overlap because the overlap is real manufacturing intent.

Use this only for overlaps that a mechanical reviewer would accept as actual matter sharing volume: welded/fused regions, overmolded inserts, potted electronics, cast-in hardware, or deliberately bonded laminations. This is not a shortcut for screws without holes, shafts without bores, covers without pockets, or parts placed with collision as a positioning hack.

`forgecad inspect mechanical-integrity --collisions` only honors this declaration when both shapes are returned as visible objects and the exact collision report finds that same object pair. Unused or non-visible declarations fail the quality gate so annotations cannot hide unrelated collisions.

```ts
verify.intentionalOverlap("rubber grip is overmolded on handle", rubberGrip, handleCore, "overmolded insert");
```

#### `verify.notColliding(label: string, a: ShapeLike, b: ShapeLike, searchLength?: number): void` — Check that two shapes do not share positive volume.

Face-to-face contact is allowed; use `verify.minClearance()` when an actual running gap is required.

#### `verify.minClearance(label: string, a: ShapeLike, b: ShapeLike, minGap: number, searchLength?: number): void` — Check that a minimum clearance gap exists between two shapes.

#### `verify.clearanceBetween(label: string, a: ShapeLike, b: ShapeLike, minGap: number, maxGap: number, searchLength?: number): void` — Check that the clearance gap between two shapes is inside an allowed range.

Use this for seated and retained interfaces where a part must be close enough to be mechanically accountable, but must not collide beyond the allowed minimum. It catches both failure modes that make generated CAD look fake: parts floating away from their receiver, and parts intersecting their receiver because the pocket, bore, or running clearance was not modeled.

For contact, use a narrow range such as `[-0.01, 0.05]` to tolerate tiny numerical noise. For a running fit, use the intended clearance band.

Manifold-backed shapes use exact min-gap distance. Other backends use a mesh-derived min-gap check and say so in the verification message; keep `forgecad inspect mechanical-integrity --collisions` in the acceptance gate for positive-volume interference.

```ts
verify.clearanceBetween("cover is seated on gasket", cover, gasket, -0.01, 0.05);
verify.clearanceBetween("carriage runs inside rail", carriage, rail, 0.2, 0.5);
```

#### `verify.parallel(label: string, faceA: FaceRefLike, faceB: FaceRefLike, toleranceDeg?: number): void` — Check that two face normals are parallel (within toleranceDeg degrees).

`FaceRefLike`: `{ normal: Vec3, center: Vec3 }`

#### `verify.perpendicular(label: string, faceA: FaceRefLike, faceB: FaceRefLike, toleranceDeg?: number): void` — Check that two face normals are perpendicular (within toleranceDeg degrees).

#### `verify.coplanar(label: string, faceA: FaceRefLike, faceB: FaceRefLike, toleranceDeg?: number, toleranceMm?: number): void` — Check that a face is coplanar with (same plane as) another face, meaning they are parallel AND their centers lie on the same plane.

#### `verify.faceAt(label: string, face: FaceRefLike, expectedPos: Vec3, toleranceMm?: number): void` — Check that a face center lies at a specific position (within toleranceMm).

#### `verify.sameDirection(label: string, faceA: FaceRefLike, faceB: FaceRefLike, toleranceDeg?: number): void` — Check that two face normals point in the same direction (not antiparallel). Stricter than parallel — both |angle| AND sign must match.

#### `verify.isEmpty(label: string, shape: ShapeLike, message?: string): void` — Check that a shape is empty.

#### `verify.notEmpty(label: string, shape: ShapeLike, message?: string): void` — Check that a shape is NOT empty.

#### `verify.volumeApprox(label: string, shape: ShapeLike, expected: number, tolerance?: number): void` — Check that a shape's volume is approximately equal to expected (mm³).

#### `verify.areaApprox(label: string, shape: ShapeLike, expected: number, tolerance?: number): void` — Check that a shape's surface area is approximately equal to expected (mm²).

#### `verify.boundingBoxSize(label: string, shape: ShapeLike, expectedSize: Vec3, tolerance?: number): void` — Check that a shape's bounding box has approximately the given size.

#### `verify.edgeContinuity(label: string, shape: ShapeLike, options?: EdgeContinuityThresholds): void` — Check that every sampled seam on a shape meets a requested continuity threshold.

**`EdgeContinuityThresholds`**: `continuity?: SurfaceContinuity`, `samples?: number`, `positionTolerance?: number`, `tangentToleranceDeg?: number`, `curvatureTolerance?: number`

#### `verify.noTinyEdges(label: string, shape: ShapeLike, threshold?: number): void` — Check that a shape has no tiny edges below the requested threshold.

#### `verify.noSliverFaces(label: string, shape: ShapeLike, threshold?: number): void` — Check that a shape has no sliver faces below the requested score threshold.

#### `verify.noSelfIntersection(label: string, shape: ShapeLike): void` — Best-effort exact-shape validity guard for self-intersections or broken B-Rep topology.

#### `spec(name: string, checkFn: (...args: any[]) => void): Spec` — Create a named, reusable bundle of verification checks.

A spec groups related `verify.*` calls under a collapsible header in the Checks panel. This makes large check suites scannable. Specs can be applied to multiple shapes and can check relationships between parts.

Specs can be defined in separate `.forge.js` files and imported via `require()` to share them across models.

`spec.check()` returns a `SpecResult` — you can inspect it programmatically or ignore the return value and let the Checks panel show results.

```ts
const printable = spec("Fits printer bed", (shape) => {
  verify.notEmpty("Has geometry", shape);
  const bb = shape.boundingBox();
  verify.lessThan("Width  < 220mm", bb.max[0] - bb.min[0], 220);
  verify.lessThan("Depth  < 220mm", bb.max[1] - bb.min[1], 220);
  verify.lessThan("Height < 250mm", bb.max[2] - bb.min[2], 250);
});

// Reuse on multiple shapes
printable.check(bracket);
printable.check(standoff);

// Check relationships between parts
const fitSpec = spec("Assembly fit", (partA, partB) => {
  verify.notColliding("No interference", partA, partB, 10);
});
fitSpec.check(bracket, standoff);
```

**Spec-first workflow:** Write specs before building geometry. Checks go from red to green as you build — effectively TDD for CAD.

**`Spec`**
- `name: string` — The display name of this spec

---

## Classes

### `Shape`

Core 3D solid shape. All operations are immutable and return new shapes.

Supports transforms (translate, rotate, scale, mirror, transform, rotateAround, pointAlong), booleans (add, subtract, intersect), cutting (split, splitBy, splitByPlane, trimByPlane, splitBySurface, trimBySurface), shelling, anchor positioning (attachTo, onFace), placement references, and queries (volume, surfaceArea, boundingBox, isEmpty, numTri, geometryInfo).

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `materialProps` | `ShapeMaterialProps \| undefined` | — |

**Freeform Construction**

#### `slicePerpendicularToX(x: number, profile: Sketch, options?: FromSlicesAxisSliceOptions): FromSlicesSlice` — Create a slice descriptor perpendicular to the X axis.

The profile is drawn in the YZ plane. `options.center` is `[y, z]`, so authors can place changing section centers without manually translating sketches in ForgeCAD's internal plane axes.

```js
Shape.fromSlices([
  Shape.slicePerpendicularToX(-20, ellipse(10, 2), { center: [0, 3] }),
  Shape.slicePerpendicularToX(20, ellipse(8, 1.5), { center: [0, 6] }),
]);
```

**`FromSlicesAxisSliceOptions`**
- `center?: FromSlicesVec2` — Plane-local profile center. XY uses [x, y], XZ uses [x, z], YZ uses [y, z].

#### `slicePerpendicularToY(y: number, profile: Sketch, options?: FromSlicesAxisSliceOptions): FromSlicesSlice` — Create a slice descriptor perpendicular to the Y axis.

The profile is drawn in the XZ plane. `options.center` is `[x, z]`.

#### `slicePerpendicularToZ(z: number, profile: Sketch, options?: FromSlicesAxisSliceOptions): FromSlicesSlice` — Create a slice descriptor perpendicular to the Z axis.

The profile is drawn in the XY plane. `options.center` is `[x, y]`.

#### `sliceThrough(center: FromSlicesVec3, normal: FromSlicesVec3, profile: Sketch): FromSlicesSlice` — Create a slice descriptor through a world point with an arbitrary plane normal.

The profile origin lands at `center`. Use this when the section plane is not one of the world XY/XZ/YZ planes.

#### `sliceOnFrame(frame: FromSlicesFrameInput, profile: Sketch): FromSlicesSlice` — Create a slice descriptor on a full 3D work frame.

Sheet frame helpers return the right shape for `frame`. Use `Sheet.frameAt()` for tangent construction planes, or `Sheet.framePerpendicularToU()` / `Sheet.framePerpendicularToV()` for cross-sections normal to a surface path. On the Manifold backend, framed slices are lofted in input order when every slice comes from a frame.

**`FromSlicesFrameInput`**

| Option | Type | Description |
|--------|------|-------------|
| `point?` | `FromSlicesVec3` | World-space frame origin. Sheet frame helpers return this as `point`. |
| `origin?` | `FromSlicesVec3` | Alias for `point` when using generic CAD frame terminology. |
| `normal` | `FromSlicesVec3` | World-space frame normal. |
| `tangentU?` | `FromSlicesVec3` | World-space direction for the profile's local X axis. Sheet frame helpers return this as `tangentU`. |
| `tangentV?` | `FromSlicesVec3` | Optional world-space direction for the profile's local Y axis. Sheet frame helpers return this as `tangentV`. |
| `xAxis?` | `FromSlicesVec3` | Alias for `tangentU`. |
| `yAxis?` | `FromSlicesVec3` | Alias for `tangentV`. |

#### `fromSlices(slices: FromSlicesSlice[], options?: FromSlicesOptions): Shape` — Construct a 3D shape from cross-section slices on one or more planes.

On the Manifold backend, slices created with `Shape.sliceOnFrame()` are lofted in their input order while preserving each full 3D frame. Other slices with the same normal direction are lofted together. Slices with different normals are combined via smooth radial blending — each silhouette constrains the shape's extent, producing smooth ellipsoidal cross-sections.

```js
// Egg from two orthogonal silhouettes
const eggProfile = ellipse(15, 25);
return Shape.fromSlices([
  { on: 'xz', at: 0, profile: eggProfile },
  { on: 'yz', at: 0, profile: eggProfile },
]);
```

```js
// Vase with cross-section transitions
return Shape.fromSlices([
  Shape.slicePerpendicularToZ(0, circle2d(20)),
  Shape.slicePerpendicularToZ(40, rect(25, 25)),
  Shape.slicePerpendicularToZ(80, circle2d(8)),
  Shape.slicePerpendicularToY(0, vaseOutline),
]);
```

**`FromSlicesSlice`**

| Option | Type | Description |
|--------|------|-------------|
| `on` | `SlicePlane` | Plane normal: axis name or arbitrary unit vector. |
| `at?` | `number` | Signed offset along the normal from the origin. Omit when `center` defines the plane. |
| `center?` | `FromSlicesVec3` | World-space point where the 2D profile origin should land on the slice plane. |
| `profile` | `Sketch` | 2D cross-section profile on that plane. |
| `frame?` | `FromSlicesFramePlacement` | Full 3D section frame, preserved for ordered lofts through rotating planes. |

**`FromSlicesFramePlacement`**

| Option | Type | Description |
|--------|------|-------------|
| `point` | `FromSlicesVec3` | World-space frame origin. |
| `normal` | `FromSlicesVec3` | World-space section normal. |
| `tangentU` | `FromSlicesVec3` | World-space direction for the profile's local X axis. |
| `tangentV` | `FromSlicesVec3` | World-space direction for the profile's local Y axis. |

**`FromSlicesOptions`**
- `edgeLength?: number` — Marching-grid edge length for level-set meshing (Manifold only).
- `boundsPadding?: number` — Extra bounding-box padding (Manifold only).

**Appearance**

#### `color(value: string | undefined): Shape` — Set the color of this shape (hex string, e.g. "#ff0000"). Returns a new Shape with the color applied.

#### `material(props: ShapeMaterialProps): Shape` — Set PBR material properties for this shape's visual appearance.

Returns a new Shape with the specified material properties merged on top of any previously set properties. All properties are optional — omitted keys retain their current value. Material properties survive transforms and boolean operations.

Use `.color()` to set the base diffuse color; `.material()` controls how that color behaves under light (metalness, roughness, clearcoat) and can add emissive glow independent of lighting.

```js
box(50, 50, 50).material({ metalness: 0.9, roughness: 0.1 }); // polished metal
sphere(30).material({ emissive: '#ff6b35', emissiveIntensity: 2 }); // glowing
cylinder(40, 20).material({ opacity: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.02 }); // ice

// Chainable with other shape methods
box(100, 100, 10).color('#gold').material({ metalness: 0.95, roughness: 0.05 }).translate(0, 0, 50);
```

**Face Topology**

#### `face(selector: FaceSelector): FaceRef` — Resolve a face by user-authored label or compiler-owned name. Returns a `FaceRef` that can be passed to `.onFace()`, `projectToPlane()`, or used directly in placement.

`.face(name)` is a pure label lookup — it finds faces by user-authored labels, not by geometric queries. Labels are born in sketches via `.label()` / `.labelEdges()` and grow into face names through extrude, loft, revolve, and sweep. They are stable references that travel with the geometry.

Labels must be unique within a shape. Use `.prefixLabels()` before combining shapes with `union()` / `difference()` to avoid collisions. Collision detection throws a clear error with a fix suggestion.

Boolean survival: `union()` and `intersection()` carry labels from every operand; `difference()` carries only the base (first) operand's labels — cutter labels are dropped. A surviving label addresses whatever portion of its face survives the boolean; cutters may split or erase it, and a lineage shared by multiple union operands resolves as a face set rather than a single face.

For compile-covered shapes (extrude, loft, etc.) the lookup resolves via the shape's compile plan. As a fallback, planar-faced mesh shapes (e.g. results of boolean ops) are resolved via coplanar triangle clustering.

```ts
// Edge labels become side face names after extrude
const profile = path()
  .moveTo(0, 0)
  .lineTo(100, 0).label('floor')
  .lineTo(100, 50).label('wall')
  .lineTo(0, 50).label('ceiling')
  .closeLabel('left-wall');
const room = profile.extrude(30, { labels: { start: 'base', end: 'top' } });
room.face('floor');   // side face from the labeled edge
room.face('base');    // base cap (user-specified)

// .labelEdges() shorthand for sequential edge labeling
const plate = rect(100, 50).labelEdges('south', 'east', 'north', 'west');
const solid = plate.extrude(20, { labels: { start: 'bottom', end: 'top' } });
solid.face('south'); // side face

// Prefix before combining to avoid collisions
const left = wing.prefixLabels('l/');
const right = wing.mirror([1, 0, 0]).prefixLabels('r/');
const full = union(left, right);
full.face('l/upper'); // left wing upper surface
```

#### `faces(): FaceRef[]` — Return faces matching a query, or label semantic faces when passed a mapping.

Mapping form returns a new shape: `shape.faces({ lid: 'top', walls: ['front', 'back', 'left', 'right'] })`.

#### `faceNames(): string[]` — List defined semantic face names currently available on this shape.

#### `prefixLabels(prefix: string): Shape` — Prefix all user-authored face labels, including semantic labels from `faces(mapping)`. Returns a new shape with modified labels.

#### `renameLabel(from: string, to: string): Shape` — Rename a single face label. Returns a new shape.

#### `dropLabels(...names: string[]): Shape` — Remove specific face labels. Returns a new shape.

#### `dropAllLabels(): Shape` — Remove all face labels. Returns a new shape.

#### `faceHistory(name: string): FaceTransformationHistory` — Get the transformation history for a specific face.

**Edge Topology**

#### `edge(name: string): EdgeRef` — Get a named topology edge. Only available on shapes with tracked topology (from box/cylinder/extrude).

#### `edgeNames(): string[]` — List named topology edge names. Returns empty array if shape has no tracked topology.

#### `edgesOf(faceLabel: string, options?: EdgesOfOptions): EdgeSegment[]` — Return all boundary edges of a named face.

Finds edges where one adjacent mesh face belongs to the target face and the other belongs to a different face. The result is coalesced (tessellation fragments merged) and can be passed directly to `fillet()` or `chamfer()`.

This is a topological query — no coordinates, no tolerances, no minimum-length hacks. It works because an edge is the boundary between two faces.

```js
// Fillet all top edges of a mounting plate
let plate = box(120, 80, 6).faces({ workSurface: 'top' })
plate = fillet(plate, 3, plate.edgesOf('workSurface'))

// Shelled enclosure — fillet the outer lip
let body = box(80, 50, 35).faces({ opening: 'top' })
body = body.shell(2, { openFaces: ['top'] })
body = fillet(body, 1.5, body.edgesOf('opening'))

// Filter: only concave edges (after a boolean subtraction)
body.edgesOf('top', { concave: true })
```

**`EdgesOfOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `exclude?` | `string \| string[]` | Exclude edges shared with these named faces. |
| `convex?` | `boolean` | Additional geometric filter: only convex edges. |
| `concave?` | `boolean` | Additional geometric filter: only concave edges. |
| `minLength?` | `number` | Minimum edge length filter. |

#### `edgesBetween(faceA: string, faceB: string | string[]): EdgeSegment[]` — Return edges shared between two named faces.

An edge is "between" faces A and B when one of its adjacent mesh triangles belongs to A and the other belongs to B. This is the most precise topological edge selection — "fillet the edges where the top meets the wall."

The second argument can be a single face name or an array (edges between A and any of B1, B2, ...).

```js
// Fillet the edge where lid meets one wall
let body = box(100, 60, 30).faces({ lid: 'top', wall: 'side-left' })
body = fillet(body, 2, body.edgesBetween('lid', 'wall'))

// Fillet a cylinder rim — where the flat cap meets the curved barrel
let tube = cylinder(30, 10).faces({ cap: 'top', barrel: 'side' })
tube = fillet(tube, 1, tube.edgesBetween('cap', 'barrel'))

// Multiple target faces at once
body.edgesBetween('lid', ['left-wall', 'right-wall', 'front-wall', 'back-wall'])
```

**Transforms**

#### `translate(x: number, y: number, z: number): Shape` — Move the shape relative to its current position. All transforms are immutable and return new shapes.

#### `translatePolar(radius: number, angleDeg: number, z?: number): Shape` — Translate using polar coordinates (radius + angle in degrees). Eliminates manual `r * Math.cos(angle * PI/180)` calculations.

Example: `shape.translatePolar(50, 30)` moves 50mm at 30 degrees from +X.

#### `moveTo(x: number, y: number, z: number): Shape` — Position the shape so its bounding box min corner is at the given global coordinate.

#### `moveToLocal(target: Shape | { toShape(): Shape; }, x: number, y: number, z: number): Shape` — Position the shape relative to another shape's local coordinate system (bounding box min corner).

#### `rotate(axis: Vec3, angleDeg: number, options?: { pivot?: Vec3; }): Shape` — Rotate around an arbitrary axis through the origin. Unlike `Sketch.rotate()` (bounding-box center), this pivots at the world origin — pass `options.pivot` to rotate in place.

#### `rotateX(angleDeg: number, options?: { pivot?: Vec3; }): Shape` — Rotate around the X axis by the given angle in degrees.

#### `rotateY(angleDeg: number, options?: { pivot?: Vec3; }): Shape` — Rotate around the Y axis by the given angle in degrees.

#### `rotateZ(angleDeg: number, options?: { pivot?: Vec3; }): Shape` — Rotate around the Z axis by the given angle in degrees.

#### `rotateAroundTo(axis: Vec3, pivot: Vec3, movingPoint: RotationPointLike, targetPoint: RotationPointLike, options?: RotateAroundToOptions): Shape` — Rotate around an axis until a moving point reaches the target line/plane defined by the axis and target point. `movingPoint` / `targetPoint` may be raw world points or this shape's anchors/references.

`RotateAroundToOptions`: `{ mode?: RotateAroundToMode }`

#### `transform(m: Mat4 | Transform): Shape` — Apply a 4x4 affine transform matrix (column-major) or a Transform object.

#### `placeOnFrame(frame: FrameInput, options?: FramePlacementOptions): Shape` — Place the shape on a validated frame-like record. Equivalent to `shape.transform(Transform.fromFrame(frame, options))`.

**`FramePlacementOptions`**
- `offset?: number` — Offset the placed origin along the resolved frame local +Z axis.

#### `scale(v: number | Vec3): Shape` — Scale the shape uniformly or per-axis from the shape's bounding box center. Accepts a single number or [x, y, z] array.

#### `scaleAround(pivot: Vec3, v: number | Vec3): Shape` — Scale the shape uniformly or per-axis from an explicit pivot point.

#### `mirror(normal: Vec3): Shape` — Mirror across a plane through the shape's bounding box center, defined by its normal vector.

#### `mirrorThrough(point: Vec3, normal: Vec3): Shape` — Mirror across a plane through an explicit point, defined by its normal vector.

#### `pointAlong(direction: Vec3): Shape` — Reorient a shape so its primary axis (Z) points along the given direction. Useful for laying cylinders/extrusions along X or Y without thinking about Euler angles. The shape's origin stays at [0,0,0] — translate after pointAlong to position it.

Example: cylinder(40, 5).pointAlong([1, 0, 0]) — lays cylinder along X, starting at origin

**Booleans & Cutting**

#### `add(...others: ShapeOperandInput[]): Shape` — Union this shape with others (additive boolean). Method form of union().

#### `subtract(...others: ShapeOperandInput[]): Shape` — Subtract other shapes from this one. Method form of difference().

#### `intersect(...others: ShapeOperandInput[]): Shape` — Keep only the overlap with other shapes. Method form of intersection().

#### `split(cutter: Shape | { toShape(): Shape; }): [ Shape, Shape ]` — Split into [inside, outside] by another shape.

#### `splitBy(cutter: Shape | { toShape(): Shape; }): ShapeSplitResult` — Split this shape by a cutter volume and return named inside/outside pieces.

Use `outside()` for the base with the cutter removed, and `inside()` for the extracted overlap. This is the named-result form of `split(cutter)`, which returns the same pieces as `[inside, outside]`.

```js
const cut = body.splitBy(buttonCutter);
const bodyWithPocket = cut.outside();
const buttonBlank = cut.inside().translate(0, 0, 0.8);
```

#### `splitByPlane(normal: Vec3, originOffset?: number): [ Shape, Shape ]` — Split by infinite plane. Returns [positive-side, negative-side].

#### `trimByPlane(normal: Vec3, originOffset?: number): Shape` — Keep the positive side of the plane and discard the opposite side.

#### `splitBySurface(surface: Shape | { toShape(): Shape; }): ShapeSurfaceSplitResult` — Split this shape by an oriented support surface.

Planes delegate to the exact infinite-plane trim. Full cylinders and spheres split by their implicit support surface: `positive()` is outside, `negative()` is inside. Untrimmed open NURBS sheets use the sheet normal to define the positive side.

#### `trimBySurface(surface: Shape | { toShape(): Shape; }): Shape` — Keep the positive signed-distance side of a support surface.

**Features**

#### `shell(thickness: number, opts?: { openFaces?: string[]; }): Shape` — Hollow out compile-covered boxes, cylinders, and straight extrudes. `openFaces` names any subset of the base shape's labeled faces to leave open (no wall).

#### `pocket(face: FaceSelector, depth: number, opts?: PocketOptions): Shape` — Cut a pocket (cavity) into this solid through the named face.

```js
box(100, 100, 20).pocket('top', 8)
box(100, 100, 20).pocket('top', 8, { inset: 5 })
box(100, 100, 20).pocket('top', 8, { scale: 0.8 })
```

**`PocketOptions`**
- `inset?: number` — Shrink the face boundary inward by this many mm before extruding. Produces angled walls when combined with depth. Default: 0 (full face).
- `scale?: number` — Scale the face profile uniformly (e.g. 0.8 = 80% of the face area). Mutually exclusive with `inset`; `inset` takes precedence if both are set.
- `join?: "Square" | "Round" | "Miter"` — Corner join style when using `inset`. Default: 'Round'.

#### `boss(face: FaceSelector, height: number, opts?: BossOptions): Shape` — Add a boss (protrusion) from the named face.

```js
box(100, 100, 20).boss('top', 5)
box(100, 100, 20).boss('top', 10, { scale: 0.6 })
```

#### `hole(faceOrRef: SketchFaceTarget | FaceRef, opts: ShapeHoleOptions): Shape` — Drill a hole into this solid at a face.

```js
box(50, 50, 20).hole('top', { diameter: 8, depth: 10 })
box(50, 50, 20).hole('top', { diameter: 6, counterbore: { diameter: 12, depth: 3 } })
```

**`FaceRef`**

| Option | Type | Description |
|--------|------|-------------|
| `normal` | `Vec3` | Normal direction of the face |
| `center` | `Vec3` | Center point of the face |
| `query?` | `FaceQueryRef` | Compiler-owned face query when available. |
| `planar?` | `boolean` | True when the face can host a 2D sketch placement frame |
| `uAxis?` | `Vec3` | Face-local horizontal axis for planar faces |
| `vAxis?` | `Vec3` | Face-local vertical axis for planar faces |
| `surface?` | `FaceSurface` | Analytic surface family when the backend can identify one. |
| `descendant?` | `FaceDescendantMetadata` | Shared descendant-resolution metadata when this face is a semantic region/set. |

Also: `name: FaceName`.

**`FaceDescendantMetadata`**: `kind: "single" | "face-set"`, `semantic: FaceDescendantSemantic`, `memberCount: number`, `memberNames: string[]`, `coplanar: boolean`

**`ShapeHoleOptions`**: `diameter: number`, `depth?: number`, `upToFace?: SketchFaceTarget | FaceRef`, `extent?: ShapeFeatureExtentOptions`, `u?: number`, `v?: number`, `counterbore?: { diameter: number; depth: number; }`, `countersink?: { diameter: number; angleDeg?: number; }`, `thread?: ShapeHoleThreadOptions`

`ShapeFeatureExtentOptions`: `{ forward: ShapeFeatureExtentSideOptions, reverse?: ShapeFeatureExtentSideOptions }`

`ShapeFeatureExtentSideOptions`: `{ depth?: number, upToFace?: SketchFaceTarget | FaceRef, through?: boolean }`

**`ShapeHoleThreadOptions`**: `designation?: string`, `pitch?: number`, `class?: string`, `handedness?: "right" | "left"`, `depth?: number`, `modeled?: boolean`

#### `cutout(sketch: Sketch, opts?: ShapeCutoutOptions): Shape` — Cut a profile-shaped pocket through a face using a placed sketch.

The sketch must be placed on a face with `Sketch.onFace(...)`. The cut follows the sketch's 2D profile.

```js
const profile = circle2d(10).onFace(body, 'top');
body.cutout(profile, { depth: 5 })
```

**`ShapeCutoutOptions`**: `depth?: number`, `upToFace?: SketchFaceTarget | FaceRef`, `extent?: ShapeFeatureExtentOptions`, `taperScale?: number | Vec2`

**Placement**

#### `placeReference(ref: PlacementAnchorLike, target: Vec3, offset?: Vec3): Shape` — Translate the shape so the given anchor or reference lands on the target coordinate.

Accepts any built-in anchor name (`'bottom'`, `'center'`, `'top-front-left'`, etc.) or a custom placement reference attached via `withReferences()`.

```javascript
// Ground a shape — put its bottom face center at Z = 0
shape.placeReference('bottom', [0, 0, 0])

// Center at the world origin
shape.placeReference('center', [0, 0, 0])

// Align left edge to X = 10
shape.placeReference('left', [10, 0, 0])
```

#### `attachTo(target: ShapeAnchorTarget, targetAnchor: PlacementAnchorLike, selfAnchor?: PlacementAnchorLike, offset?: Vec3): Shape` — Position this shape relative to another using named 3D anchor points.

Anchors are bounding-box-relative: 'center', face centers ('top', 'front', ...), edge midpoints ('top-front', 'back-left', ...), and corners ('top-front-left', ...). Anchor word order is flexible: 'front-left' and 'left-front' are equivalent. Named placement references (from withReferences) can also be used as anchors.

#### `onFace(parent: ShapeAnchorTarget, face: "front" | "back" | "left" | "right" | "top" | "bottom", opts?: { u?: number; v?: number; protrude?: number; }): Shape` — Place this shape on a face of a parent shape.

Think of it like sticking a label on a box surface:

- `face` picks which surface ('front', 'back', 'top', etc.)
- `u, v` position within that face's 2D plane (from center)
- front/back: u = left/right (X), v = up/down (Z)
- left/right: u = forward/back (Y), v = up/down (Z)
- top/bottom: u = left/right (X), v = forward/back (Y)
- `protrude` = how far the child sticks out (positive = outward from face)

#### `seatInto(target: Shape, surface: string, options?: SeatIntoOptions): Shape` — Slide this shape along an axis until a labeled face is embedded in the target body.

Place the shape near the intended interface first (translate/rotate), then call seatInto to auto-adjust the penetration depth. No manual coordinate math needed.

```js
// Wing root embeds into fuselage — adapts to any fuselage shape
wing.translate(0, wingY, 0).seatInto(fuselage, 'root');

// Sensor pod sits flush on fuselage surface
pod.translate(0, station, radius + 20).seatInto(fuselage, 'base', { depth: 'flush' });

// Antenna with 3mm gasket standoff
mast.translate(0, station, radius + 50).seatInto(fuselage, 'mount', { depth: 'flush', gap: 3 });
```

**`SeatIntoOptions`**
- `along?: Vec3` — Movement axis. Default: inverted face normal (points into target).
- `depth?: "full" | "flush" | number` — How deep to embed. 'full' = entire face inside. 'flush' = nearest point touches. number = mm past flush. Default: 'full'.
- `gap?: number` — Standoff gap in mm. Positive = gap between face and target. Negative = extra penetration. Default: 0.

#### `seatOver(target: Shape, targetSurface: string, options?: SeatIntoOptions): Shape` — Slide this shape until a target's labeled face is fully covered (inside this shape).

The inverse of `seatInto`: instead of embedding *your* face into the target, you move until the *target's* face is embedded inside you.

```js
// Nacelle moves up until pylon's bottom face is inside the nacelle
nacelle.translate(initialOffset).seatOver(pylon, 'bottom');

// Cap slides down over a post until post's top face is covered
cap.translate(initialOffset).seatOver(post, 'top');
```

**Connectors**

#### `withConnectors(connectors: Record<string, ConnectorInput>): Shape` — Attach named connectors — attachment points that survive transforms and imports. Connectors can be bare (position + orientation) or typed (with connectorType/gender for compatibility matching).

`PortInput`: `{ origin?: Vec3, axis?: Vec3, start?: Vec3, end?: Vec3, up?: Vec3, kind?: JointType, min?: number, max?: number }`

`ConnectorInput`: `{ connectorType?: string, gender?: ConnectorGender, measurements?: Record<string, number | string> }`

#### `connectorNames(): string[]` — List all connector names on this shape.

#### `connectorsByType(type: string): Array<{ name: string; port: ConnectorDef; }>` — Get all connectors of a given type.

#### `connectorDistance(nameA: string, nameB: string): number` — Distance between two connector origins on this shape.

#### `connectorMeasurements(name: string): Record<string, number | string>` — Get measurements metadata from a connector.

#### `matchTo(targetOrPairs: Shape | MatchTarget | Array<[ Shape | MatchTarget, string, string ]>, selfConnOrDict?: string | Record<string, string>, targetConnOrOptions?: string | MatchToOptions, maybeOptions?: MatchToOptions): Shape` — Position this shape by matching connectors to a target.

Alignment: with a single connector pair, the shape translates and rotates so the connector origins coincide and the axes oppose (plug-in model); `up` pins the roll. With multiple pairs, the connector origins define the rigid transform — still author meaningful `axis`/`up` values so the same connectors remain useful for `connect()`, audits, and future matching.

Overloads:

- Single pair: `matchTo(target, selfConn, targetConn, options?)`
- Dictionary (same target): `matchTo(target, { selfConn: targetConn, ... }, options?)`
- Multi-target: `matchTo([ [target1, selfConn1, targetConn1], ... ], options?)`

`MatchToOptions`: `{ force?: boolean, angle?: number, distance?: number }`

**References**

#### `withReferences(refs: PlacementReferenceInput): Shape` — Attach named placement references that survive normal transforms and imports.

**`PlacementReferenceInput`**: `points?: Record<string, Vec3>`, `edges?: Record<string, PlacementEdgeRef>`, `surfaces?: Record<string, PlacementSurfaceRef>`, `objects?: Record<string, PlacementObjectInput>`

`PlacementEdgeRef`: `{ start: Vec3, end: Vec3 }`

`PlacementSurfaceRef`: `{ center: Vec3, normal: Vec3 }`

#### `referenceNames(kind?: PlacementReferenceKind): string[]` — List named placement references carried by this shape.

#### `referencePoint(ref: PlacementAnchorLike): Vec3` — Resolve a named placement reference or built-in anchor to a 3D point.

**Measurement**

#### `boundingBox(): ShapeRuntimeBounds` — Get the axis-aligned bounding box as { min: [x,y,z], max: [x,y,z] }.

#### `volume(): number` — Volume in mm cubed.

#### `surfaceArea(): number` — Surface area in mm squared.

#### `isEmpty(): boolean` — True if the shape contains no geometry.

#### `numBodies(): number` — Number of disconnected solid bodies in this shape.

#### `numTri(): number` — Triangle count of the mesh representation.

**Other**

#### `withPhysicalMaterial(material: PhysicalMaterialInput): Shape` — Assign an engineering material used by `PhysicalProperties.*` reports.

This is separate from `.material(...)`, which only controls viewport PBR appearance. The assigned physical material is immutable metadata and survives clone, transforms, imports, grouping, and same-material booleans.

#### `physicalMaterial(): PhysicalMaterialDef | undefined` — Inspect the engineering material assigned to this shape, if any.

#### `wrapTexture(image: ImageHandle, projection: UvProjectionSpec): Shape` — Wrap an imported bitmap image around this shape using a projection.

The `image` comes from `Import.image('path.png')`; the `projection` is one of the `Wrap.*` helpers — `Wrap.flat({ onto: 'top' })` lays it flat on a face, `Wrap.aroundCylinder({ axis: 'z' })` wraps it like a can label, `Wrap.onSphere()` maps it like a globe, and `Wrap.box()` cube-maps it onto the six sides.

By default the image **auto-fits** the shape — one copy across the relevant extent, so no `width`/`height`/`size` is needed (pass them only to override). The (u,v) is derived from each vertex's final world position, so the image stays glued to the surface through transforms and boolean cuts with no UV layout to maintain — apply `wrapTexture` *after* positioning the shape. Returns a new Shape; the original is unchanged.

```js
const logo = Import.image('./logo.png');
box(80, 80, 10).wrapTexture(logo, Wrap.flat({ onto: 'top' }));            // auto-fits the face

const label = Import.image('./label.jpg');
cylinder(60, 20).wrapTexture(label, Wrap.aroundCylinder({ axis: 'z' }));  // wraps the side
```

`ImageHandle`: `{ __forgeImage: true, dataUri: string, width: number, height: number, mimeType: string, byteLength: number }`

#### `clone(): Shape` — Return a new Shape wrapper for explicit duplication in scripts.

#### `geometryInfo(): GeometryInfo` — Inspect which backend/representation produced this solid.

#### `as(name: string): Shape` — Name this shape as a reference namespace for diagnostics and future published refs.

#### `ref(path: string): ShapeRef` — Resolve a semantic reference path like `lid`, `lid/back`, or a midpoint selector on `lid/back`.

#### `thicken(thickness: ThicknessInput): Shape` — Offset-thicken an exact open surface or shell into a solid.

#### `getMesh(): ShapeRuntimeMesh` — Extract triangle mesh for Three.js rendering

#### `slice(offset?: number): any` — Slice the runtime solid by a plane normal to local Z at the given offset.

#### `project(): any` — Orthographically project the runtime solid onto the local XY plane.

**Compatibility Aliases**

- `withPorts()` -> `withConnectors()`
- `portNames()` -> `connectorNames()`

### `ShapeSplitResult`

Named result of splitting a shape by a cutter volume.

`inside()` is the base-cutter overlap. `outside()` is the base with the cutter removed. Both sides come from the same cutter definition, so extracted inserts and their receiving pockets stay topologically paired instead of being rebuilt from independent dimensions.

**Pieces**

#### `inside(): Shape` — Return the portion of the base shape that lies inside the cutter.

#### `outside(): Shape` — Return the portion of the base shape that remains outside the cutter.

#### `parts(): ShapeSplitParts` — Return both split pieces as named properties.

### `ShapeSurfaceSplitResult`

Named result of splitting a shape by an oriented support surface.

`positive()` returns the side pointed to by the surface normal or positive signed-distance field. `negative()` returns the opposite side. For planes, this matches `splitByPlane()` ordering. For full cylinders and spheres, positive is outside the implicit surface and negative is inside it.

**Pieces**

#### `positive(): Shape` — Return the positive signed-distance side of the surface split.

#### `negative(): Shape` — Return the negative signed-distance side of the surface split.

#### `parts(): ShapeSurfaceSplitParts` — Return both split pieces as named properties.

### `Transform`

#### `static identity(): Transform` — Return the identity transform.

#### `static from(input: TransformInput): Transform` — Wrap an existing `Transform` or raw 4x4 matrix as a `Transform`.

#### `static fromFrame(frame: FrameInput, options?: FramePlacementOptions): Transform` — Build a rigid transform from a frame-like record.

Accepts an existing `Transform`, raw column-major `Mat4`, records with `matrix`, datum/surface-style `{ origin|point, u|v|normal }` axes, route ports with `xAxis`/`yAxis`/`axis`, and connector-style `{ origin, axis, up }`. The frame must define a right-handed rigid basis; axis-only records are rejected because they do not define roll.

`options.offset` moves the frame origin along the resolved local +Z axis.

#### `static compose(...steps: TransformInput[]): Transform` — Compose transforms in chain order: `Transform.compose(a, b, c)` applies `a`, then `b`, then `c` — the same left-to-right order as `Transform.from(a).mul(b).mul(c)`.

Prefer this over manual `.mul()` chains when composing 3+ transforms (e.g. kinematics: `local -> childBase -> jointMotion -> jointFrame -> parentWorld`); the variadic form makes the application order explicit and prevents order mistakes.

```ts
const world = Transform.compose(childBase, jointMotion, jointFrame, parentWorld);
```

#### `static translation(x: number, y: number, z: number): Transform` — Create a translation transform.

#### `static scale(v: number | Vec3): Transform` — Create a uniform or per-axis scale transform.

#### `static rotationAxis(axis: Vec3, angleDeg: number, pivot?: Vec3): Transform` — Create a rotation around an arbitrary axis, optionally about a pivot.

#### `static rotateAroundTo(axis: Vec3, pivot: Vec3, movingPoint: Vec3, targetPoint: Vec3, options?: RotateAroundToOptions): Transform` — Solve the rotation needed to move one point onto a target line or plane.

#### `mul(other: TransformInput): Transform` — Compose transforms in chain order: `a.mul(b)` applies `a`, then `b`.

#### `translate(x: number, y: number, z: number): Transform` — Translate after the current transform.

#### `rotateAxis(axis: Vec3, angleDeg: number, pivot?: Vec3): Transform` — Rotate after the current transform.

#### `rotateX(angleDeg: number, pivot?: Vec3): Transform` — Rotate about the X axis after the current transform (parity with `Shape.rotateX`).

#### `rotateY(angleDeg: number, pivot?: Vec3): Transform` — Rotate about the Y axis after the current transform (parity with `Shape.rotateY`).

#### `rotateZ(angleDeg: number, pivot?: Vec3): Transform` — Rotate about the Z axis after the current transform (parity with `Shape.rotateZ`).

#### `inverse(): Transform` — Return the inverse transform.

#### `point(p: Vec3): Vec3` — Transform a point using homogeneous coordinates.

#### `vector(v: Vec3): Vec3` — Transform a direction vector without translation.

#### `toArray(): Mat4` — Return the transform as a raw 4x4 matrix array.

### `ShapeGroup`

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `children` | `GroupChild[]` | — |
| `childNames` | `Array<string \| undefined>` | — |

**Children**

#### `child(name: string): GroupChild` — Return the named child by name. Throws if not found. Useful when importing a multipart group and working on components individually.

#### `childName(index: number): string | undefined` — Return the optional name of the child at `index`.

**Transforms**

#### `translate(x: number, y: number, z: number): ShapeGroup` — Move the entire group by (x, y, z). All children move together as a unit.

#### `moveTo(x: number, y: number, z: number): ShapeGroup` — Move the group so its bounding-box min corner lands at the given coordinate.

#### `moveToLocal(target: Shape | ShapeGroup, x: number, y: number, z: number): ShapeGroup` — Move the group relative to another part's bounding-box min corner.

#### `rotate(axis: Vec3, angleDeg: number, options?: { pivot?: Vec3; }): ShapeGroup` — Rotate the group around an arbitrary axis through the origin. Unlike `scale()`/`mirror()` (bounding-box center) and `Sketch.rotate()`, this pivots at the world origin — pass `options.pivot` to rotate in place.

#### `rotateX(angleDeg: number, options?: { pivot?: Vec3; }): ShapeGroup` — Rotate the group around the X axis.

#### `rotateY(angleDeg: number, options?: { pivot?: Vec3; }): ShapeGroup` — Rotate the group around the Y axis.

#### `rotateZ(angleDeg: number, options?: { pivot?: Vec3; }): ShapeGroup` — Rotate the group around the Z axis.

#### `rotateAroundAxis(axis: Vec3, angleDeg: number, pivot?: Vec3): ShapeGroup` — Rotate around an arbitrary axis, optionally through a pivot point.

#### `rotateAroundTo(axis: Vec3, pivot: Vec3, movingPoint: Anchor3D | Vec3, targetPoint: Anchor3D | Vec3, options?: RotateAroundToOptions): ShapeGroup` — Rotate around an axis until a moving point reaches the target line/plane defined by the axis and target point. ShapeGroup string points use built-in anchors only.

#### `pointAlong(direction: Vec3): ShapeGroup` — Reorient the group so its local Z axis points along `direction`.

#### `transform(m: Mat4 | Transform): ShapeGroup` — Apply a 4x4 transform matrix or `Transform` to all 3D children.

#### `scale(v: number | Vec3): ShapeGroup` — Scale uniformly or per-axis from the group's bounding-box center.

#### `scaleAround(pivot: Vec3, v: number | Vec3): ShapeGroup` — Scale uniformly or per-axis from an explicit pivot point.

#### `mirror(normal: Vec3): ShapeGroup` — Mirror across a plane through the group's bounding-box center.

#### `mirrorThrough(point: Vec3, normal: Vec3): ShapeGroup` — Mirror across a plane through an explicit point.

**Placement**

#### `placeReference(ref: PlacementAnchorLike, target: Vec3, offset?: Vec3): ShapeGroup` — Translate the group so the given anchor or reference lands on the target coordinate.

Accepts any built-in anchor name (`'bottom'`, `'center'`, `'top-front-left'`, etc.) or a custom placement reference attached via `withReferences()`.

```javascript
// Ground a group — put its bottom at Z = 0
assembly.placeReference('bottom', [0, 0, 0])

// Use a custom reference from a multi-file part
const placed = require('./bracket-assembly.forge.js').group
  .placeReference('mountCenter', [0, 0, 50]);
```

#### `attachTo(target: Shape | ShapeGroup, targetAnchor: Anchor3D | string, selfAnchor?: Anchor3D, offset?: Vec3): ShapeGroup` — Attach this group to a face or anchor on another part.

`targetAnchor` can be a built-in anchor name or a custom reference name on the target. `selfAnchor` selects the anchor on this group to align.

#### `onFace(parent: Shape | ShapeGroup, face: "front" | "back" | "left" | "right" | "top" | "bottom", opts?: { u?: number; v?: number; protrude?: number; }): ShapeGroup` — Place this group on a face of a parent shape. See Shape.onFace() for full documentation.

**Connectors**

#### `withConnectors(connectors: Record<string, ConnectorInput>): ShapeGroup` — Attach named connectors — attachment points that survive transforms. Connectors can be bare (position + orientation) or typed (with connectorType/gender for compatibility matching).

#### `connectorNames(): string[]` — List all connector names, including "ChildName.connectorName" from named children.

#### `connectorsByType(type: string): Array<{ name: string; port: ConnectorDef; }>` — Get all connectors of a given type, including from named children.

#### `connectorDistance(nameA: string, nameB: string): number` — Distance between two connector origins on this group (supports dotted child paths).

#### `connectorMeasurements(name: string): Record<string, number | string>` — Get measurements metadata from a connector (supports dotted child paths).

#### `matchTo(targetOrPairs: Shape | ShapeGroup | Array<[ Shape | ShapeGroup, string, string ]>, selfConnOrDict?: string | Record<string, string>, targetConnOrOptions?: string | MatchToOptions, maybeOptions?: MatchToOptions): ShapeGroup` — Position this group by matching connectors to a target. Connector names support dotted paths into named children: "ChildName.connectorName".

Alignment: with a single connector pair, the group translates and rotates so the connector origins coincide and the axes oppose (plug-in model); `up` pins the roll. With multiple pairs, the connector origins define the rigid transform — still author meaningful `axis`/`up` values so the same connectors remain useful for `connect()`, audits, and future matching.

Overloads:

- Single pair: `matchTo(target, selfConn, targetConn, options?)`
- Dictionary (same target): `matchTo(target, { selfConn: targetConn, ... }, options?)`
- Multi-target: `matchTo([ [target1, selfConn1, targetConn1], ... ], options?)`

**References**

#### `withReferences(refs: PlacementReferenceInput): ShapeGroup` — Attach named placement references to this group. References survive normal transforms (translate/rotate/scale/mirror/transform).

```javascript
const bracket = group(
  { name: 'Left', shape: leftShape },
  { name: 'Right', shape: rightShape },
).withReferences({
  points: { mountCenter: [0, 0, 0] },
});
```

#### `referenceNames(kind?: PlacementReferenceKind): string[]` — List named placement references carried by this group.

#### `referencePoint(ref: PlacementAnchorLike): Vec3` — Resolve a named placement reference or built-in Anchor3D to a 3D point. Named refs take priority over built-in anchors.

**Other**

#### `clone(): ShapeGroup` — Return a deep-cloned ShapeGroup tree (refs copied).

#### `boundingBox(): { min: Vec3; max: Vec3; }` — Return the combined 3D bounding box of all children.

#### `color(hex: string): ShapeGroup` — Return a copy of the group with the given display color applied to each child.

#### `withPhysicalMaterial(material: PhysicalMaterialInput): ShapeGroup` — Assign one engineering material to every solid child in this group.

#### `physicalMaterial(): PhysicalMaterialDef | undefined` — Inspect the group's common engineering material. Throws when children are mixed.

**Compatibility Aliases**

- `withPorts()` -> `withConnectors()`
- `portNames()` -> `connectorNames()`

### `SurfacePattern`

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `body` | `string` | Function body: receives (u, v) in surface mm, returns height displacement. |
| `constants` | `Record<string, number>` | Named constants injected into the function. |

### `Pattern2D`

#### `add(...patterns: Pattern2DInput[]): Pattern2D` — Add this pattern to one or more patterns or constant height offsets.

#### `subtract(pattern: Pattern2DInput): Pattern2D` — Subtract another pattern or constant height offset from this pattern.

#### `multiply(...patterns: Pattern2DInput[]): Pattern2D` — Multiply this pattern by one or more patterns or numeric scale factors.

#### `min(...patterns: Pattern2DInput[]): Pattern2D` — Keep the lower height between this pattern and one or more other patterns.

#### `max(...patterns: Pattern2DInput[]): Pattern2D` — Keep the higher height between this pattern and one or more other patterns.

#### `clamp(min: number, max: number): Pattern2D` — Limit pattern height to the inclusive `[min, max]` range in millimeters.

#### `abs(): Pattern2D` — Convert negative heights to positive heights.

#### `negate(): Pattern2D` — Flip the pattern height sign.

### `Pattern2DBuilder`

#### `constant(value?: number): Pattern2D` — Create a constant-height pattern in millimeters.

#### `sineWave(options: Pattern2DSineWaveOptions): Pattern2D` — Create a sinusoidal wave pattern in UV space.

**`Pattern2DSineWaveOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `direction?` | `Vec2` | Direction the wave advances in UV space. Default: [1, 0]. |
| `wavelength` | `number` | Distance between wave peaks in surface millimeters. |
| `amplitude?` | `number` | Height amplitude in millimeters. Default: 1. |
| `phase?` | `number` | Phase offset in radians. Default: 0. |
| `bias?` | `number` | Constant height offset in millimeters. Default: 0. |

#### `stripes(options: Pattern2DStripesOptions): Pattern2D` — Create recessed stripe bands in UV space.

**`Pattern2DStripesOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `direction?` | `Vec2` | Direction perpendicular to the stripe bands in UV space. Default: [1, 0]. |
| `spacing` | `number` | Center-to-center spacing in surface millimeters. |
| `width` | `number` | Stripe width in surface millimeters. |
| `depth?` | `number` | Stripe groove depth in millimeters. Default: 1. |

#### `overUnderWeave(options: Pattern2DOverUnderWeaveOptions): Pattern2D` — Create an over-under woven relief pattern in UV space.

**`Pattern2DOverUnderWeaveOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `spacing` | `number \| Vec2` | Thread center-to-center spacing. A number uses the same spacing for U and V. |
| `threadWidth` | `number \| Vec2` | Thread width. A number uses the same width for U and V. |
| `depth?` | `number` | Thread groove depth in millimeters. Default: 0.8. |
| `underScale?` | `number` | Relative height of the under-crossing thread. Default: 0.15. |

### `Path2DParamValue`

Runtime value returned by `Param.path2d()`.

Use closed paths as editable profile outlines via `toSketch()`. Use open paths as editable centerlines via `toStroke(width)`.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `closed` | `boolean` | True when this path is intended to close back to its first point. |

**Methods:**

#### `points(): Vec2[]` — Return the current points as `[x, y]` pairs in the editor coordinate system.

#### `toSketch(): Sketch` — Convert a closed editable path into a sketch profile.

This is the common path for hand-edited plates, outlines, and 2D section profiles that will be extruded, subtracted, or used in sketch booleans. Throws for open paths; use `toStroke(width)` for editable centerlines.

#### `toStroke(width: number, join?: "Round" | "Square"): Sketch` — Convert an editable path into a stroked sketch with physical width.

Use this for rails, ribs, cable routes, gasket paths, and other open centerlines. Closed paths can also be stroked when the intent is a looped band rather than a filled profile.

### `Spline2DParamValue`

Runtime value returned by `Param.spline2d()`.

Spline params preserve both editable point coordinates and each point's continuity intent (`G0`, `G1`, or `G2`). Convert them to curves for sweeps and loft rails, or to sampled paths when an API expects plain points.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `closed` | `boolean` | True when this spline is intended to close back to its first point. |
| `degree` | `number` | Requested fitting degree before any automatic reduction for short spans. |

**Methods:**

#### `points(): Vec2[]` — Return the current control nodes as `[x, y]` pairs without continuity metadata.

#### `nodes(): Spline2DPointDef[]` — Return the current editable nodes, including per-point `g` continuity values.

#### `continuities(): Spline2DContinuity[]` — Return only the per-node continuity intents in point order.

#### `toPolyline(samples?: number): Vec2[]` — Sample the spline into 2D `[x, y]` points.

Use this when downstream code needs a polyline instead of a curve object.

#### `toCurveOnXY(z?: number, options?: Spline2DCurveOptions): NurbsCurve3D` — Fit the editable spline as a 3D curve on the XY plane at constant `z`.

The point's `x` maps to world X and `y` maps to world Y.

`Spline2DCurveOptions`: `{ degree?: number, samples?: number }`

#### `toCurveOnXZ(y?: number, options?: Spline2DCurveOptions): NurbsCurve3D` — Fit the editable spline as a 3D curve on the XZ plane at constant `y`.

The point's `x` maps to world X and `y` maps to world Z. This is useful for side-view height/depth profiles such as spoon bowls, handles, and rails.

#### `toCurveOnYZ(x?: number, options?: Spline2DCurveOptions): NurbsCurve3D` — Fit the editable spline as a 3D curve on the YZ plane at constant `x`.

The point's `x` maps to world Y and `y` maps to world Z.

#### `toCurveSegmentsOnXY(z?: number, options?: Spline2DCurveOptions): NurbsCurve3D[]` — Fit the spline on XY and return separate curve segments split at `G0` nodes.

Use segment output when a hard break should remain visible to downstream code instead of being joined into one continuous curve.

#### `toCurveSegmentsOnXZ(y?: number, options?: Spline2DCurveOptions): NurbsCurve3D[]` — Fit the spline on XZ and return separate curve segments split at `G0` nodes.

#### `toCurveSegmentsOnYZ(x?: number, options?: Spline2DCurveOptions): NurbsCurve3D[]` — Fit the spline on YZ and return separate curve segments split at `G0` nodes.

#### `toPathOnXY(z?: number, options?: Spline2DCurveOptions): Vec3[]` — Sample the spline as 3D points on the XY plane at constant `z`.

This is useful for sweeps and surface helpers that accept point paths.

#### `toPathOnXZ(y?: number, options?: Spline2DCurveOptions): Vec3[]` — Sample the spline as 3D points on the XZ plane at constant `y`.

#### `toPathOnYZ(x?: number, options?: Spline2DCurveOptions): Vec3[]` — Sample the spline as 3D points on the YZ plane at constant `x`.

### `Placement2DParamValue`

Runtime value returned by `Param.placement2d()`.

Placement sheets return semantic item positions. The model decides what each item means geometrically, so users can drag named blocks without editing the construction code.

#### `items(): Placement2DItemPlacement[]` — Return all current item placements as immutable copies.

#### `positions(): Record<string, Placement2DItemPlacement>` — Return current placements keyed by item id for table-style lookup.

#### `item(id: string): Placement2DItemPlacement` — Return one named item placement.

Throws if `id` was not declared in the sheet, which keeps model code tied to stable semantic item IDs rather than fragile list indices.

### `CurveNetBuilder`

#### `alongRails(railA: CurveInput, railB: CurveInput): this` — Use two lengthwise boundary curves as guide rails.

Chain `.sections(...)` to create a bi-rail surface: the rails define the sheet edges while each section curve shapes the cross-span at its station.

#### `sections(...curves: CurveInput[]): this` — Add crosswise section curves.

By itself this skins the sections into a surface. After `.alongRails(...)`, the sections are fitted between the two rails so the surface follows both the boundary guide curves and the section profiles.

#### `resolution(samples: number): this` — Set the sampling resolution used to build curve-family surface grids.

This affects `.lengthwise(...)`, `.crosswise(...)`, and `.alongRails(...).sections(...)` surfaces. It does not resample explicit `.cage(grid)` input because the cage already is the authored control net.

#### `matchStartU(condition: BoundaryCondition): this` — Enforce a continuity condition on the `u = 0` (left) boundary.

Pass `{ edge }` to match an adjacent sheet's tangent (G1) or curvature (G2), or `{ tangent }` to impose an explicit cross-boundary direction. See `BoundaryCondition`.

**`BoundaryCondition`**

| Option | Type | Description |
|--------|------|-------------|
| `edge?` | `SheetEdge` | Match the tangent (G1) and curvature (G2) of an existing sheet edge across this boundary. |
| `tangent?` | `Vec3` | Or impose an explicit cross-boundary tangent direction in world space (auto-normalized). |
| `tangentScale?` | `number` | Scalar magnitude for the imposed `tangent` ramp, in model units. Ignored when `edge` is given. Default: the local cross-boundary control-span length (chord-scaled), so the imposed tangent has the same strength as the surface already carries — no magic number. |
| `continuity?` | `0 \| 1 \| 2` | Continuity order to enforce on this side. Default inferred: 1 if a tangent or edge is given, else 0. G2 (curvature) requires an `edge` to copy the neighbor's second difference. |

**`SheetEdge`**
- `fixed: "u" | "v"` — Which parameter is held fixed along this edge.
- `value: 0 | 1` — The fixed value (0 or 1).
- Also: `sheet: Sheet`.

#### `matchEndU(condition: BoundaryCondition): this` — Enforce a continuity condition on the `u = 1` (right) boundary. See `matchStartU`.

#### `matchStartV(condition: BoundaryCondition): this` — Enforce a continuity condition on the `v = 0` (front) boundary. See `matchStartU`.

#### `matchEndV(condition: BoundaryCondition): this` — Enforce a continuity condition on the `v = 1` (rear) boundary. See `matchStartU`.

#### `closedU(): this` — Weld the two ends of the U direction into a tangent-continuous periodic loop, so the `u = 0` and `u = 1` boundaries coincide with NO G0 kink (a closed tube/ring in U — e.g. a bowl's around-rim seam). The cage's first and last U rows must already be coincident (the loop must close in position).

#### `closedV(): this` — Weld the two ends of the V direction into a tangent-continuous periodic loop. See `closedU`.

#### `toSheet(): Sheet` — Build (once) and return the Sheet.

- `lengthwise(...curves: CurveInput[]): this`
- `crosswise(...curves: CurveInput[]): this`
- `cage(grid: Vec3[][]): this`
- `degree(u: number, v: number): this`
- `get frontEdge(): SheetEdge`
- `get rearEdge(): SheetEdge`
- `get leftEdge(): SheetEdge`
- `get rightEdge(): SheetEdge`
- `get frontCurve(): NurbsCurve3D`
- `get rearCurve(): NurbsCurve3D`
- `get leftCurve(): NurbsCurve3D`
- `get rightCurve(): NurbsCurve3D`
- `get surface(): BSplineSurface`
- `pointAt(u: number, v: number): Vec3`
- `normalAt(u: number, v: number): Vec3`
- `frameAt(u: number, v: number, options?: SheetFrameOptions): SheetFrame`
- `framePerpendicularToU(u: number, v: number, options?: SheetFrameOptions): SheetFrame`
- `framePerpendicularToV(u: number, v: number, options?: SheetFrameOptions): SheetFrame`
- `curvatureAt(u: number, v: number): SurfaceCurvature`
- `curveAlong(edge: SheetEdge): NurbsCurve3D`
- `curveAlongU(v: number): NurbsCurve3D`
- `curveAlongV(u: number): NurbsCurve3D`
- `pathAlong(edge: SheetEdge, options?: SheetPathAlongOptions): Vec3[]`
- `pathAlongBoundary(spans: SheetBoundaryPathSpan[], options?: SheetBoundaryPathOptions): Vec3[]`
- `pathAlongU(v: number, options?: SheetPathAlongOptions): Vec3[]`
- `pathAlongV(u: number, options?: SheetPathAlongOptions): Vec3[]`
- `thicken(wall: number, options?: { resolution?: number; }): Shape`
- `thickenInsideBy(thickness: ThicknessInput, options?: { resolution?: number; }): Shape`
- `matchEdge(edge: SheetEdge): MatchEdgeBuilder`

**`SheetFrameOptions`**
- `normalOffset?: number` — Offset the frame origin along the analytic surface normal. Default 0.

**`SheetPathAlongOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `samples?` | `number` | Samples along the path span. Default 32. |
| `start?` | `number` | Normalized start parameter along the path. Default 0. |
| `end?` | `number` | Normalized end parameter along the path. Default 1. |
| `reverse?` | `boolean` | Return points from end to start after sampling the span. Default false. |
| `normalOffset?` | `number` | Offset each path point along the analytic surface normal. Default 0. |

**`SheetBoundaryPathSpan`**

| Option | Type | Description |
|--------|------|-------------|
| `edge` | `SheetEdge` | Boundary edge to sample for this span. |
| `start?` | `SheetPathParameter` | Normalized edge parameter or world point projected to the closest edge parameter. Default 0. |
| `end?` | `SheetPathParameter` | Normalized edge parameter or world point projected to the closest edge parameter. Default 1. |
| `samples?` | `number` | Samples along this edge span. Defaults to options.samplesPerEdge or 32. |

**`SheetBoundaryPathOptions`**
- `samplesPerEdge?: number` — Samples for spans that do not specify their own count. Default 32.
- `normalOffset?: number` — Offset each path point along the analytic surface normal. Default 0.
- `tolerance?: number` — Maximum allowed gap between adjacent sampled spans. Default 1e-6.

### `MatchEdgeBuilder`

- `toG0(neighbor: SheetEdge): Sheet`
- `toG1(neighbor: SheetEdge): Sheet`
- `toG2(neighbor: SheetEdge): Sheet`

### `BridgeBuilder`

#### `bulge(a: number, b: number): this` — Tune the influence of each side (Rhino-style bulge).

- `g0(): Sheet`
- `g1(): Sheet`
- `g2(): Sheet`

### `SurfaceComplexBuilder`

#### `patch(name: string, sheet: Sheet): this` — Add a named parametric surface patch to the complex.

#### `join(name: string, edgeA: SurfaceComplexEdgeInput, edgeB: SurfaceComplexEdgeInput, options?: SurfaceComplexJoinOptions): this` — Declare that two existing patch edges are intended to meet.

**`SurfaceComplexJoinOptions`**
- `continuity?: SurfaceComplexContinuity` — Requested continuity between two existing patch edges. Defaults to G0.

#### `bridge(name: string, edgeA: SurfaceComplexEdgeInput, edgeB: SurfaceComplexEdgeInput, options?: SurfaceComplexBridgeOptions): this` — Add a named bridge patch between two existing patch edges.

**`SurfaceComplexBridgeOptions`**
- `continuity?: SurfaceComplexContinuity` — Requested continuity at both sides of the bridge. Defaults to G1.
- `bulge?: readonly Vec2` — Optional cross-bridge tangent scale. The first value controls departure from edge A and the second controls arrival at edge B.

#### `parts(options?: SurfaceComplexShapeOptions): Array<{ name: string; shape: Shape; }>` — Return the named solid parts produced by thickening each patch.

**`SurfaceComplexShapeOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `wall?` | `number` | Wall thickness used when sheets are converted to solids. |
| `resolution?` | `number` | Surface tessellation resolution. |
| `colors?` | `Record<string, string>` | Optional per-patch colors for grouped output. |
| `color?` | `string` | Optional color applied after all patches are unioned. |

#### `toGroup(options?: SurfaceComplexShapeOptions): ShapeGroup` — Convert the complex into a named group while preserving patch identity.

#### `surfaceParts(options?: SurfaceComplexSewnSolidOptions): Array<{ name: string; shape: Shape; }>` — Return the named open surface faces for inspection or exact sewing.

**`SurfaceComplexSewnSolidOptions`**

| Option | Type | Description |
|--------|------|-------------|
| `resolution?` | `number` | Surface tessellation resolution used by preview/mesh backends. |
| `tolerance?` | `number` | Sewing tolerance for neighboring patch edges. |
| `validate?` | `boolean` | Whether the backend should validate the closed shell while building. |
| `colors?` | `Record<string, string>` | Optional per-patch colors for surface inspection groups. |
| `color?` | `string` | Optional color applied to the final solid. |

#### `toSurfaceGroup(options?: SurfaceComplexSewnSolidOptions): ShapeGroup` — Convert the complex into a named group of open surface faces.

#### `toSolid(options?: SurfaceComplexShapeOptions): Shape` — Convert the complex into one solid by unioning all thickened patches.

#### `toSewnSolid(options?: SurfaceComplexSewnSolidOptions): Shape` — Sew the surface faces and ask the backend to make one closed solid B-rep.

#### `report(samples?: number): SurfaceComplexReport` — Measure requested joins and list still-open patch edges.

### `ShapeRef`

A first-class reference path over a shape's semantic faces and face relationships.

Created with `shape.ref("lid/back")`, then refined through methods such as `.point()` or `.edges()`. The reference stores intent as a readable path and resolves lazily against the current shape metadata.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `path` | `string` | — |

**Methods:**

#### `resolve(): ShapeReferenceResolution` — Resolve this reference into its current faces, edges, or points.

#### `get kind(): ShapeReferenceKind` — The resolved reference kind, such as `face`, `edge-set`, or `point`.

#### `get cardinality(): ShapeReferenceCardinality` — Whether the reference currently resolves to zero, one, or many matches.

#### `status(): ShapeReferenceStatus` — Return the reference lifecycle status for the current shape state.

#### `explain(): string` — Return a human-readable explanation of how this reference resolved.

#### `as(name: string): ShapeRef` — Name this derived reference so the same shape can resolve it by `shape.ref(name)`.

#### `maybe(): ShapeRef` — Return an optional reference that resolves to zero matches instead of throwing when missing.

#### `all(): ShapeRef` — Mark that a multi-match reference is intentionally being used as a set.

#### `one(): ShapeRef` — Require this reference to resolve to exactly one match.

#### `faces(): FaceRef[]` — Resolve this reference as one or more faces.

#### `face(): FaceRef` — Resolve this reference as exactly one face.

#### `edges(): EdgeSegment[]` — Resolve this reference as one or more edges. Face references return boundary edges.

#### `edge(): EdgeSegment` — Resolve this reference as exactly one edge.

#### `points(): Vec3[]` — Resolve this reference as one or more points. Faces use centers and edges use midpoints.

#### `point(): Vec3` — Resolve this reference as exactly one point.

#### `toJSON(): ShapeReferenceResolution` — Return the structured JSON-friendly reference resolution.

#### `toString(): string` — Return a compact display form for this reference path.

---

## Constants

### `ANCHOR3D_NAMES`

### `verify`

Members (full entries under [Verification](#verification)): `verify.that`, `verify.equal`, `verify.notEqual`, `verify.greaterThan`, `verify.lessThan`, `verify.inRange`, `verify.centersCoincide`, `verify.connectorDistance`, `verify.physicalComponentCount`, `verify.intentionalOverlap`, `verify.notColliding`, `verify.minClearance`, `verify.clearanceBetween`, `verify.parallel`, `verify.perpendicular`, `verify.coplanar`, `verify.faceAt`, `verify.sameDirection`, `verify.isEmpty`, `verify.notEmpty`, `verify.volumeApprox`, `verify.areaApprox`, `verify.boundingBoxSize`, `verify.edgeContinuity`, `verify.noTinyEdges`, `verify.noSliverFaces`, `verify.noSelfIntersection`.

### `Points`

- `distance(a: Vec3, b: Vec3): number` — Euclidean distance between two 3D points.
- `midpoint(a: Vec3, b: Vec3): Vec3` — Center point between two 3D points.
- `lerp(a: Vec3, b: Vec3, t: number): Vec3` — Linearly interpolate between two 3D points. t=0 returns a, t=1 returns b.
- `direction(a: Vec3, b: Vec3): Vec3` — Unit direction vector from a to b. Throws if a and b are the same point.
- `offset(point: Vec3, dir: Vec3, amount: number): Vec3` — Move a point along a direction vector by a given amount.
- `polar(length: number, angleDeg: number, from?: Vec2): Vec2` — Compute a 2D point at distance and angle (degrees) from an optional origin.

### `connector`

Connector factory. Create attachment points: `connector({...})`, `connector.male(type, {...})`, etc.

### `Import`

Namespaced file-format import helpers — the single vocabulary for bringing external geometry files into a model.

- `dxfSketch(fileName: string, options?: DxfImportOptions): Sketch` — Parse a DXF file and return closed 2D profile geometry as a Sketch. The result can be extruded directly.
- `svgSketch(fileName: string, options?: SvgImportOptions): Sketch` — Parse an SVG file and return it as a Sketch with options for region filtering, scaling, and simplification.
- `mesh(fileName: string, options?: MeshImportOptions): Shape | ShapeGroup` — Import an external mesh file (STL, OBJ, 3MF).

  By default, 3MF build items are flattened into one Shape for compatibility. Use `separateObjects: true` to import 3MF build items/resource objects as a named ShapeGroup whose children are targetable by `forgecad ls`. Use `object` to import one item by the stable ref/name reported by `forgecad run`.

  For 3MF sources, `forgecad run` prints a source-structure table with one line per build item: `[3mf:build:NNN:object:N] name type=... verts=... tris=... bbox=[min] → [max]`. Build items are numbered from `001`; files with no build items list resource objects as `3mf:object:N` instead. Per-item bboxes reveal multi-part structure — account for every substantial item before flattening. Pass any listed stable ref or name as `object` to import that item alone.

  Use `sourceFrame: { up: "+Y" }` when the file was authored in a non-Z-up coordinate system. ForgeCAD remains Z-up; the import is rotated so the named source axis becomes ForgeCAD +Z. Supported values: `"+X"`, `"-X"`, `"+Y"`, `"-Y"`, `"+Z"`, `"-Z"`.

  ```js
  const all = Import.mesh("./assembly.3mf", { separateObjects: true });
  const pin = all.child("Pin #001");
  const plate = Import.mesh("./assembly.3mf", { object: "3mf:build:001:object:7" });
  const yUpPart = Import.mesh("./part.obj", { sourceFrame: { up: "+Y" } });
  ```
- `step(fileName: string, options?: StepImportOptions): Shape` — Import a STEP file (.step, .stp) as an exact OCCT-backed Shape. Preserves NURBS curves, B-spline surfaces, and exact topology. Requires running with the OCCT backend. Use `sourceFrame: { up: "+Y" }` to rotate Y-up source files into ForgeCAD's Z-up world.
- `image(fileName: string): ImageHandle` — Import a bitmap image (PNG, JPEG, or WebP) as an ImageHandle for projected texturing. Reads the pixel dimensions from the file header and embeds the bytes as a data URI. Pass the result to `Shape.wrapTexture(image, projection)` with a `Wrap.*` projection.

### `Wrap`

- `flat(opts: FlatWrapOptions): UvProjectionSpec` — Project the image flat onto an axis-aligned face — `onto` is one of top/bottom/front/back/left/right. Auto-fits the face (no width/height needed).
- `aroundCylinder(opts: CylinderWrapOptions): UvProjectionSpec` — Wrap the image around a cylinder like a can label — `axis` is 'x' | 'y' | 'z'. Auto-fits one wrap around and the full height.
- `onSphere(opts?: SphereWrapOptions): UvProjectionSpec` — Map the image over a sphere like a globe (longitude/latitude). Auto-centers on the sphere.
- `box(opts?: BoxWrapOptions): UvProjectionSpec` — Cube-map the image onto a box — one copy per face. Auto-fits the box (no size needed).

### `PhysicalMaterial`

Engineering material definitions used by physical-property reports, simulation, and future BOM/drawing metadata.

Members (full entries under [Materials & Physical Properties](#materials-physical-properties)): `PhysicalMaterial.define`, `PhysicalMaterial.get`, `PhysicalMaterial.presets`.

### `PhysicalProperties`

Material-backed mass, volume, bounding-box, surface, center-of-mass, and inertia reports.

Members (full entries under [Materials & Physical Properties](#materials-physical-properties)): `PhysicalProperties.approximate`, `PhysicalProperties.exact`.
