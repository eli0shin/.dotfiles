---
skill-group: cli
skill-order: 3
---

# Structural FEA Stress Inspection

Use structural FEA when you want a ForgeCAD model to answer a load-case question:

- Where does this part see the highest stress?
- How far does it deflect?
- What is the minimum safety factor against the material yield strength?
- Did the mesh and solver produce evidence that is good enough to inspect?

ForgeCAD owns the authoring contract, solver orchestration, result feedback, and inspection report. The mesh and solve step can run in a configured cloud provider so users do not need local solver tools on their workstation. Users author a study in the model, run `forgecad sim fea run --provider daytona`, and inspect a result bundle.

## Contents

- What You Get
- Cloud Provider And Local Tools
- Author The Study
- Choose Stable Regions
- Run The Flow
- Read The Results
- Current Scope
- Troubleshooting

## What You Get

A solved FEA result bundle can produce:

- max von Mises stress
- max displacement
- minimum safety factor
- mesh quality and solver trust flags
- region-level hot spots
- `report.html`
- `summary.json`
- a safety-factor heatmap PNG
- a solver stress heatmap PNG
- a signed strain heatmap PNG where red is tension and blue is compression
- a displacement magnitude heatmap PNG

The deformed render is display-only. It helps explain the displacement shape; it does not change the stress, strain, displacement, or safety-factor numbers reported by the solver.

## Cloud Provider And Local Tools

The normal user path is cloud-backed:

```bash
export DAYTONA_API_KEY=...
forgecad sim fea run bracket.forge.js --provider daytona
```

For repeated use, configure the provider once:

```bash
export FORGECAD_FEA_PROVIDER=daytona
forgecad sim fea run bracket.forge.js
```

The Daytona account credentials must be available to the ForgeCAD CLI through `DAYTONA_API_KEY`. No local Daytona CLI, provider setup command, or snapshot name is required for `--provider daytona`.

ForgeCAD defines the Daytona FEA image internally. On the first run for a given ForgeCAD toolchain, it creates a cached Daytona snapshot in the authenticated Daytona account. Later runs reuse that snapshot and only create a fresh per-run sandbox.

The cloud runner uses a 2 vCPU, 8 GiB memory, 10 GiB disk snapshot and enforces fixed process limits so a runaway solve does not grow indefinitely:

| Limit | Default | Override |
| --- | ---: | --- |
| Remote command timeout | 1800 s | Fixed |
| Mesh + solve wall clock | 1200 s | Fixed |
| Per-process CPU time | 1800 s | Fixed |
| Per-process virtual memory | 8192 MiB | Fixed |

ForgeCAD writes `evidence/daytona-run.json` into each Daytona-backed result bundle with the sandbox id, snapshot, target, resource defaults, limits, and exit code when available. It deletes the Daytona sandbox at the end of each run. It also creates the sandbox as ephemeral with an explicit auto-stop window and immediate auto-delete after stop, so a hard-killed local CLI process should not leave a paid sandbox running for days.

Local execution still exists as a debugging path:

```bash
forgecad sim fea run bracket.forge.js --provider local
```

Run `forgecad doctor` to check local optional FEA tools. Missing local FEA tools do not block cloud-backed FEA, core ForgeCAD modeling, export, or render commands.

| Tool | Used For | Quick Check |
| --- | --- | --- |
| `uv` | Runs packaged Python scripts with pinned dependencies for local mesh/preflight | `uv --version` |
| CalculiX `ccx` | Solves the static stress deck locally | `ccx -v` |
| Bash | Runs the package script locally | `bash --version` |
| Chrome or Chromium | Renders PNG heatmaps from solved evidence | Chrome installed in a standard location, `CHROME_PATH=/path/to/chrome`, or `--chrome-path /path/to/chrome` |

ForgeCAD does not bundle solver binaries in local mode. If you redistribute solver binaries or Python wheels to customers, handle their licenses as part of your distribution.

## Author The Study

Structural FEA starts in the `.forge.js` file. The script should return an authored `assembly(...)` with:

1. a structural part marked with `Fea.body(...)`
2. one or more static stress studies from `Fea.study.staticStress(...)`
3. explicit fixtures and loads
4. a second-order tetrahedral mesh intent
5. optional render targets for default PNG outputs

```js
const aluminum = Fea.material("6061-T6", {
  densityKgM3: 2700,
  youngsModulusMPa: 68900,
  poissonRatio: 0.33,
  yieldStrengthMPa: 276,
});

const beam = box(120, 12, 12);

return assembly("Cantilever Stress Study")
  .addPart("Beam", beam, {
    fea: Fea.body({ material: aluminum }),
  })
  .withFeaStudy(
    Fea.study.staticStress("end-load", {
      fixtures: [
        Fea.fix.fixed(Fea.region.face("fixed-end", beam.face("left"))),
      ],
      loads: [
        Fea.load.force(Fea.region.face("load-end", beam.face("right")), {
          newtons: 80,
          direction: [0, 0, -1],
        }),
      ],
      target: Fea.target.minSafetyFactor(2),
      render: Fea.render.targets("safety", "stress", "strain", "displacement"),
      mesh: Fea.mesh.quadraticTets({ maxSizeMm: 4 }),
    }),
  );
```

For common early checks, ForgeCAD also provides built-in material presets:

```js
const pla = Fea.materials.isotropicPrintedPla();
const printedPla = Fea.materials.printedPla({
  infillPercent: 40,
  layerNormal: [0, 0, 1],
  rasterDirection: [1, 0, 0],
});
const copper = Fea.materials.c11000CopperAnnealed();
const aluminum = Fea.materials.aluminum6061T6();
const steel = Fea.materials.astmA36StructuralSteel();
```

`Fea.materials.isotropicPrintedPla()` is a conservative linear-elastic isotropic estimate for solid FDM/FFF PLA prints. Real printed PLA depends strongly on filament, print orientation, infill, perimeters, temperature, moisture, aging, and load duration. For load-bearing printed parts, replace the preset with `Fea.material(...)` values from your filament datasheet or measured coupons.

Use `Fea.materials.printedPla(...)` when the load case should account for print layers and infill density. It creates a homogeneous orthotropic material: the layer plane is stronger than the layer-normal direction, `infillPercent` scales effective density, stiffness, and directional yield strengths, and the generated CalculiX deck receives engineering constants plus a material orientation. Safety-factor results use a directional max-stress check in the authored material axes. This is an early design check, not a slicer-exact fracture model. It does not model bead paths, pattern-specific RVE behavior, perimeters, delamination, creep, fatigue, or certification margins.

Metal presets are grade- and temper-specific starting points. Use `Fea.material(...)` for different tempers, heat treatments, stock forms, supplier data, or coupon-tested values.

The complete API reference is generated from source in [Assembly](../generated/assembly.md). Keep reusable examples in `.forge.js` files; do not duplicate every API signature in handwritten docs.

## Choose Stable Regions

Fixtures and loads must name real geometric regions. ForgeCAD will not guess them later.

Use `Fea.region.face(...)` when you can refer to a compiler-owned exact face, such as a simple box face or a named face from the model API.

Use `Fea.region.plane(...)` when the target is a planar face created by profiles, booleans, or imported geometry and the face name is not stable enough. Make the plane specific enough that it matches exactly one STEP/Gmsh surface.

During export, ForgeCAD writes a region map and a STEP tag plan. During the package run, the Gmsh preflight matches every authored fixture/load region against the STEP surfaces. Missing or ambiguous matches fail hard. That is intentional: a silent substitute face would make the stress result untrustworthy.

## Run The Flow

Installed users run the CLI as `forgecad`. Developers running inside this repository can replace `forgecad` with `node dist-cli/forgecad.js`.

Run every authored FEA study and save an inspection result bundle:

```bash
forgecad sim fea run examples/analysis/structural-stress-fea.forge.js --provider daytona
```

Run one named study:

```bash
forgecad sim fea run bracket.forge.js --provider daytona --study side-load
```

Render a customer-facing safety view:

```bash
forgecad sim fea render out/bracket-fea/side-load --field safety
```

If the source model declares `scene({ camera })`, FEA result renders use that camera by default. Pass `--camera` to override it for a specific render.

Render the engineering stress heatmap:

```bash
forgecad sim fea render out/bracket-fea/side-load --field stress
```

Render the signed strain heatmap. Positive tensile strain renders red; negative compressive strain renders blue:

```bash
forgecad sim fea render out/bracket-fea/side-load --field strain
```

Render the displacement magnitude heatmap:

```bash
forgecad sim fea render out/bracket-fea/side-load --field displacement
```

Render a deformed stress view only when the displacement shape is useful to inspect:

```bash
forgecad sim fea render out/bracket-fea/side-load \
  --field stress \
  --shape deformed \
  --exaggerate 10
```

The deformation scale only affects the render. It does not change the reported stress, strain, displacement, or safety factor.

Each solved study result directory includes:

- `report.html` for the human inspection report
- `summary.json` for automation
- `renders/safety-factor.png` for the customer-facing safety heatmap
- `renders/stress.png` for the engineering von Mises stress heatmap

By default `forgecad sim fea run` writes safety and stress images. Add `render: Fea.render.targets("safety", "stress", "strain", "displacement")` to a study to also write `renders/strain.png` and `renders/displacement.png` during the run. Deformed-shape PNGs remain explicit render outputs from `forgecad sim fea render --shape deformed`.

Check that a model has an authored FEA study and package-ready metadata without running the solver or writing an output directory:

```bash
forgecad sim fea check bracket.forge.js --json
```

## Read The Results

Start with `report.html` or `summary.json` in the result directory. The important fields are the maximum stress, maximum displacement, minimum safety factor, hot spots, and any mesh or solver trust findings.

The default user-facing result is safety factor because it answers "is this part okay?" Use stress when you need the raw engineering von Mises field.

To split package preparation from solver execution:

```bash
forgecad sim fea prepare model.forge.js --output out/beam.feapkg
forgecad sim fea run-from-prepared out/beam.feapkg
forgecad sim fea render out/beam.feapkg --field stress --output out/stress.png
```

For most users, prefer the one-step `forgecad sim fea run --provider daytona ...` flow.

## Current Scope

Structural FEA V1 is intentionally narrow:

- linear static stress only
- one structural body per package
- exact OCCT STEP export only
- second-order tetrahedral elements only
- fixed fixtures and force loads only
- no contacts, bonded assemblies, thermal loads, buckling, fatigue, plasticity, or certification workflow

ForgeCAD refuses mesh or faceted fallback for FEA preparation. If exact geometry export, region mapping, mesh quality, solver convergence, result parsing, or evidence trust fails, the command should fail with an actionable error instead of inventing a weaker path.

## Troubleshooting

| Symptom | What It Means | What To Do |
| --- | --- | --- |
| `FEA.DAYTONA_API_KEY_MISSING` | Cloud mode was selected without Daytona credentials. | Set `DAYTONA_API_KEY` and re-run with `--provider daytona`. |
| `FEA.DAYTONA_RUN_FAILED` | The Daytona run failed before a solver feedback file was downloaded. | Check `DAYTONA_API_KEY`, automatic snapshot build logs, sandbox resources, and provider logs. |
| `FEA.SOLVER_TIMED_OUT` | The remote mesh/solve exceeded the fixed wall-clock limit. | Reduce mesh density or simplify geometry. |
| `FEA.TOOLCHAIN_UV_MISSING` | Local mode cannot find `uv`. | Use `--provider daytona`, or install `uv` for local package debugging. |
| `FEA.TOOLCHAIN_PYTHON_MISSING` | A local `PYTHON=...` override points to a missing Python executable. | Use `--provider daytona`, install Python 3, or fix the `PYTHON` path. |
| `FEA.TOOLCHAIN_GMSH_MISSING` | The selected local Python process cannot import Gmsh. | Use `--provider daytona`, prefer the default `uv` path, or install the Gmsh Python module for the override path. |
| `FEA.TOOLCHAIN_CCX_MISSING` | Local mode cannot find CalculiX as `ccx`. | Use `--provider daytona`, install CalculiX, or set `CCX=/path/to/ccx`. |
| `FEA.GMSH_FACE_MATCH_NONE` | An authored fixture/load region did not match a STEP surface. | Use a more stable face reference or a more precise planar region. |
| `FEA.GMSH_FACE_MATCH_AMBIGUOUS` | A region matched more than one STEP surface. | Make the target region more specific or change the model so the load/fixture face is unique. |
| `FEA.MESH_QUALITY_BELOW_TARGET` | The mesh exists but did not meet the package quality target. | Reduce mesh size, simplify tiny features, or improve the geometry around the hot area. |
| `FEA.SOLVER_FAILED` | CalculiX did not complete the solve. | Inspect `solver/static_stress.log`, then check fixtures, loads, material values, and over-constraint. |
| `FEA.FIELD_UNTRUSTED` | The heatmap input is not trusted package evidence. | Run inspection on the `.feapkg` result/package directory, not a copied JSON file. |

For command flags, use the [CLI reference](../CLI.md). For the public API, use the generated [Assembly reference](../generated/assembly.md).
