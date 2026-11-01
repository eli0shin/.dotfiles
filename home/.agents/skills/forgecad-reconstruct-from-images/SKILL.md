---
name: forgecad-reconstruct-from-images
description: Reconstruct a parametric ForgeCAD model from reference images, preserving the object's features and checking rendered comparisons.
forgecad-public: true
---

# Reconstruct From Images

Read `../forgecad-build-model/SKILL.md` for the functional modeling workflow, output policy, and completion criteria. Use `../forgecad/SKILL.md` for API and CLI references.

The images constrain one physical object. Match its features and proportions while building geometry that also makes sense from hidden sides. Treat occluded regions as unknowns, not permission to redesign visible features or add hardware.

## Workflow

1. Read every reference. Crop the object and small details when a screenshot hides them in a larger image. Keep temporary references and comparisons in `/tmp/<slug>-replicate/`.
2. Distinguish measured dimensions, visible geometry, and assumptions. Identify symmetry, sketch planes, extrusion depths, openings, and load-bearing junctions. Resolve uncertainties that change the construction with a focused question. This is construction reasoning, not a written brief.
3. Build the controlling exact sketches and extrude/revolve them using the model-building workflow. Match the main proportions and shared datums first. Use all supplied views to constrain the same geometry.
4. Render useful canonical views and a view close to each reference camera. Open the images. Check the collar/body thickness, openings, underside, connections, and silhouette before adding detail.
5. Make side-by-side reference comparisons. Use an explicit `--camera` specification from `../forgecad/docs/CLI.md`, then compare the actual images rather than relying on memory. Adjust the camera to match perspective, not to hide a geometry mismatch.
6. Iterate proportions and functional geometry before edge finishes. Recheck the other views after each change; improving one view must not break another.
7. Add native fillets/chamfers in the intended feature order. Open close-ups of every changed junction and edge finish, plus the underside. Run the geometric and functional checks in the model-building skill before producing requested exports.

## Comparison Helper

The bundled helper joins reference and render images without changing model geometry:

```bash
uv run <skill-dir>/scripts/compare_images.py reference.png render.png comparison.png
```

Resolve `<skill-dir>` to this skill's installed directory. Use `--fit contain` by default. Use `--fit cover` only when the images already share the same crop and aspect.

## Completion

Done means the final source passes geometric and functional checks, reference comparisons and relevant canonical/detail views have been opened and inspected, and visible mismatches have been fixed or explicitly identified. A plausible silhouette from one camera is not sufficient.

Keep the final response short: model and requested output paths, plus any important unresolved assumption or mismatch. Follow the model-building skill's output policy.
