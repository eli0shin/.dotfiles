---
name: forgecad-build-model
description: Build or edit functional ForgeCAD models with exact sketches, extrude/revolve features, native fillets/chamfers, and geometric and visual checks. Use for new parts, model revisions, or designing around an imported component.
---

# Build Functional Models

Use `../forgecad/SKILL.md` for API and CLI references. This skill owns the modeling workflow, file policy, and completion criteria for model creation and edits, including reconstruction tasks.

## Output

Produce model source and requested previews/exports. Keep temporary probes and inspection output in `/tmp` unless the user requests saved evidence. Use the existing project layout; a new small model normally needs one named folder and `main.forge.js`. Split files only when reusable parts or feature complexity require it.

**Create or update documents only when explicitly requested.** Modeling does not require a README, notes, design brief, PRFAQ, HLD, LLD, or written validation report. Keep implementation details in source. Reason about construction before coding; that reasoning is not a document deliverable.

## Workflow

### 1. Establish the construction

Read the current model and every supplied reference. Identify measured dimensions, visible features, and unknowns. Match the requested artifact; ask before changing its fastening method, part count, or operating principle. Preserve accepted geometry and viewer choices outside the requested change.

Determine the controlling sketch plane, exact profiles, extrusion/revolution directions and depths, functional cuts, and feature order. Name dimensions by their physical direction: radial projection, seam width, extrusion depth. Ask a focused question only when an unknown blocks the construction.

Proceed when every requested feature has a construction and the dimensions to be changed are unambiguous.

### 2. Build the feature tree

**Functional parts require: dimensioned exact sketches → extrude/revolve → holes, slots, pockets, ribs, and mating features → native fillets/chamfers on the intended connected edges.**

- Use shared sketch datums for related features. Regions can extend in the same direction from one plane with different extrusion depths.
- Preserve analytic arcs and circles. Verify the chosen API retains them in CAD; a higher render resolution cannot repair a polygonized profile.
- Use booleans for deliberate features and cutters in this feature tree, not as a pile of overlapping stock and corrective blend patches.
- Orient cuts for their physical use. A marker passage through a sphere follows the local surface normal; an axial cut with larger bevels is a different construction.
- Establish the complete intended outline before its edge finish. Round cutter roots before cutting when that produces the required concave roots; finish connected circle/root/bridge outlines together.
- Solve intersecting native fillets together where required. For symmetric mating halves, test finishing the common blank before splitting at the mating plane.
- Select the intended topological edges, check the selection, and inspect the result. Mesh-derived segments are not automatically native CAD edges.

Proceed when the base shape, functional features, and edge finishes exist as intended, without compensating patches for a wrong profile or cut direction.

### 3. Use a tight feature loop

Run the model with the project backend after each meaningful change. For a failed operation, isolate the smallest ForgeCAD sketch/solid that reproduces it; test the feature and inspect one close-up before putting it back into the full model. Keep geometry construction in ForgeCAD. State a confirmed API limitation rather than silently moving the build into Python/OCP or mesh postprocessing.

When a finish fails repeatedly, check profile exactness, edge selection, radius, and feature order. Repair the construction before adding complexity. Run full exports only after the local feature works.

### 4. Verify and inspect

Check three separate conditions:

- **Solid validity:** intended body count, closed geometry, and valid topology.
- **Function:** measured fit, clear passages, minimum load-bearing sections, mating clearance, and support in the intended print orientation. Probe the resulting solid, not just a parameter against its own formula. A foot must both clear nearby openings and support the lower body.
- **Appearance:** render and open views that expose every changed feature, including underside and junction close-ups. For reconstruction, open a side-by-side reference comparison. Inspect the final native STEP too when STEP is requested.

Use targeted sections, thickness, fit, or connectivity inspections when needed; read `../forgecad/docs/guides/inspection-bundles.md` to interpret them. A passing run does not prove function or visual quality. Resolve failed checks and visible mismatches, then repeat the affected checks on the final source.

### 5. Deliver

Export only after the final geometry and views pass inspection. Regenerate requested outputs from that source. Give a short completion message with file paths and any specific unverified fit or print caveat. Distinguish CAD validation from physical testing. Model-only changes use this geometric and visual loop, not generic code review; tooling/code changes still follow their review requirements.
