---
name: forgecad-reconstruct-cad-file
description: Reconstruct a readable parametric ForgeCAD model from an existing CAD or mesh file such as STL, OBJ, 3MF, STEP, or STP.
forgecad-public: true
---

# Reconstruct CAD File

The reference asset is evidence, not the deliverable. The deliverable is a readable, parametric `.forge.js` model that runs, renders, and scores well against the source. Never return `Import.mesh()`/`Import.step()` of the source as the final model unless the user explicitly asks for an import wrapper — imports are for measurement, rendering, and scoring only.

Read `../forgecad-build-model/SKILL.md` for the sketch-first construction workflow, output policy, and completion criteria. If the user wants to keep the imported file as a component and design around it, use that skill instead of reconstructing the component. For prepared benchmark/RL episodes, follow task-local benchmark instructions. Use `../forgecad/SKILL.md` for API/CLI references and `../forgecad/docs/guides/inspection-bundles.md` to interpret inspection output.

## Workflow

1. **Inspect the source directly** — the CLI reads CAD/mesh files as inputs, no wrapper script. Gather four evidence types: `ls --long` stats, an iso render, per-object views, sampled sections (invocations in CLI.md; when sharing a renderer server via `--port`, run renders sequentially).
2. **3MF**: enumerate every build item before scoring — hidden multi-part structure is a common miss. Item ref syntax: `Import.mesh` docs.
3. **Establish construction** before modeling: what must be exact vs. approximate vs. parametric; symmetry, origin, controlling sketch planes, extrusion/revolution directions and depths; scoring tolerance and alignment policy. Reason through these choices without generating a brief document.
4. **Build the base features first.** Use exact sketches and extrude/revolve to match bounds and main geometry, then add functional features and native edge finishes. Recover analytic intent rather than tracing mesh facets.
5. **Compare numerically** — the core loop:

   ```bash
   forgecad compare 3d path/to/source.stl path/to/candidate.forge.js \
     --samples 3000 --json --output /tmp/<slug>-score.json
   ```

6. **Iterate coarse to fine**: bbox/placement → main volumes/silhouette → holes/bosses/ribs/shells → edge treatments → small details.

## Reading the Score

Alignment: start `--align none`. Use `--align center` only when origins clearly differ but scale and orientation match. Use `--align center-scale` only for exploratory diagnosis — it hides dimensional errors.

| Signal | Diagnosis |
|---|---|
| Low coverage | Missing or extra surface |
| High RMS | Broad proportional mismatch |
| High p95/max | Localized outlier feature (protrusion, hole) |
| Bounds delta | Size, origin, or scale mismatch |
| Volume delta | Mass, shell, cutout, or scale mismatch |

Calibration: 95+ simple prismatic/revolved parts, 90+ ordinary mechanical parts with fillets/cutouts, 80+ acceptable for organic, faceted, or underdetermined sources. Always report raw rms, p95, max, coverage, bounds delta, and volume delta — a high overall score with a large max can hide a missing local feature.

Faceted sources: decide whether tessellation itself is evidence. Matching low-poly faceting raises the score but reduces parametric clarity — prefer analytic intent unless faceting is part of the artifact or required by the acceptance criteria.

## Done Criteria

The final model must run, render, re-compare at `--samples 5000`, and pass an `inspect compare overlay`. Open and inspect the overlay and views that expose changed features. Use targeted sections, thickness, fit, or connectivity checks when needed, following `../forgecad-build-model/SKILL.md`. Give a short completion message with source and candidate paths, key comparison metrics, and known mismatches classified as intentional simplification or remaining work. Keep temporary scores and inspection output in `/tmp` under the model-building skill's output policy.
