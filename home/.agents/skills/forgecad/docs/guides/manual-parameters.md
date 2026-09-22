---
skill-group: core
skill-order: 6
---

# Manual Parameter Sheets

Manual parameters are constrained design data: the script owns the structure and
the user edits only the declared values. They are for cases where a numeric
slider is the wrong shape of input.

## Contents

- Decision Ladder
- Path2D
- Spline2D
- Placement2D
- Spatial Anchors
- Saving

## Decision Ladder

Use the smallest parameter type that matches the design intent:

| Intent | Use |
| --- | --- |
| One scalar dimension, count, angle, or toggle | `Param.number()`, `Param.bool()`, `Param.choice()` |
| A repeated table of named scalar fields | `Param.list()` |
| A hand-shaped polygon, section outline, or open centerline | `Param.path2d()` |
| A smooth hand-shaped curve with tangent/curvature intent | `Param.spline2d()` |
| Named semantic blocks arranged in zones | `Param.placement2d()` |

Do not use `path2d` or `spline2d` as a generic table. Use them when dragging
points is meaningfully better than editing numbers.

## Path2D

`Param.path2d(name, points, opts)` returns a `Path2DParamValue`.

- Closed paths are filled profile intent: call `.toSketch()`.
- Open paths are centerline intent: call `.toStroke(width)`.
- `x` and `y` ranges define the initial editor frame, not hard movement limits.
- Override keys are `Name[0].x`, `Name[0].y`, and `Name.__count__`.

```javascript
const outline = Param.path2d('Outline', [[-30, -15], [30, -15], [24, 18], [-28, 16]], {
  closed: true,
  minPoints: 3,
  maxPoints: 12,
  unit: 'mm',
  anchor: Param.anchor.sheetOnXY([0, 0, 8], { label: 'Top outline' }),
});

return outline.toSketch().extrude(4);
```

## Spline2D

`Param.spline2d(name, points, opts)` returns a `Spline2DParamValue`.

- Each point has `g`: `G0` for a hard break, `G1` for tangent smooth, `G2` for
  curvature smooth.
- Use `.toCurveOnXY()`, `.toCurveOnXZ()`, or `.toCurveOnYZ()` for sweeps and
  curve consumers.
- Use `.toPathOnXY()`, `.toPathOnXZ()`, or `.toPathOnYZ()` when an API expects
  sampled points.
- Override keys are `Name[0].x`, `Name[0].y`, `Name[0].g`, and `Name.__count__`.

```javascript
const sideProfile = Param.spline2d('Side Profile', [
  { x: 0, y: 0, g: 'G2' },
  { x: 35, y: 8, g: 'G2' },
  { x: 70, y: 3, g: 'G1' },
], {
  unit: 'mm',
  anchor: Param.anchor.sheetOnXZ([0, -20, 0], { label: 'Side profile' }),
});

const rail = sideProfile.toCurveOnXZ();
```

## Placement2D

`Param.placement2d(name, spec)` returns a `Placement2DParamValue`.

- The script declares stable item IDs, footprints, optional zones, and rules.
- The user moves named items; the model decides what each item creates.
- Use `.item(id)` for one placement or `.positions()` for keyed lookup.
- Override keys are item based: `Layout.battery.x`, `Layout.battery.y`,
  `Layout.battery.angle`, and `Layout.battery.zone`.

```javascript
const layout = Param.placement2d('Internal Layout', {
  frame: { size: [120, 80] },
  zones: [{ id: 'electronics', size: [70, 70], center: [-20, 0] }],
  items: [
    { id: 'battery', footprint: { type: 'rect', size: [42, 24] }, zone: 'electronics', at: [-25, 0] },
    { id: 'speaker', footprint: { type: 'circle', radius: 12 }, at: [32, 8] },
  ],
  rules: { bounds: 'prevent', collisions: 'warn', snap: 1 },
  anchor: Param.anchor.sheetOnXY([0, 0, 12], { label: 'Internal layout' }),
});

const battery = layout.item('battery');
const batteryBlock = box(42, 24, 6).translate(battery.x, battery.y, 3);
```

## Spatial Anchors

Every parameter type can carry optional viewport metadata through `anchor`.
Anchors do not change geometry.

- `Param.anchor.point([x, y, z])` creates a clickable pin for scalar, string,
  list, boolean, or choice parameters.
- `Param.anchor.sheetOnXY([x, y, z])` places a 2D sheet in the XY plane at
  fixed Z.
- `Param.anchor.sheetOnXZ([x, y, z])` places a 2D sheet in the XZ plane at
  fixed Y.
- `Param.anchor.sheetOnYZ([x, y, z])` places a 2D sheet in the YZ plane at
  fixed X.

The parameter still appears in the parameter panel when `anchor` is omitted; it
just has no 3D pin or spatial sheet.

## Saving

Dragging a manual sheet writes parameter overrides first. The source model keeps
the declared defaults until those overrides are intentionally folded back into
code. Use snapshots for named parameter states, and use the parameter panel's
AI handoff for manual canvas edits when the desired result should become source.
