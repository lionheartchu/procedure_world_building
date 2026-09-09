# Sediment Field — procedural noise study

A small procedural landscape study for the Trace Habitat / Procedural World
Building branch. One continuous noise field is sampled twice: once into a 2D
map, once into a displaced 3D grid, so parameter changes can be read in both
views at the same time. A lightweight sediment simulation then runs on top of
that static field and collects material in the basins.

    noise stack (layer A + layer B)
      -> shaping operation
      -> base height field H(u, v)
      -> terrain vertices / base field map / simulation ground

    H  +  sediment simulation S(x, z, t)
      -> sediment map, terrain tint, a small elevation lift

```
npm install
npm run dev
```

## Structure

| File | Role |
|---|---|
| `src/lib/noise.js` | Seeded 2D simplex noise + fBm |
| `src/lib/field.js` | The shared sampler, the shaping operations, grid builders |
| `src/lib/sediment.js` | The sediment simulation |
| `src/lib/palette.js` | Palette, height ramp, simulation colour scale |
| `src/components/Terrain.jsx` | Displaced grid, height-aware shader, tidal plane, sim stepping |
| `src/components/FieldMap.jsx` | 2D view of the base field |
| `src/components/SimulationMap.jsx` | 2D view of the sediment field |
| `src/components/Atmosphere.jsx` | Gradient sky shell, drifting motes |
| `src/components/Scene.jsx` | Canvas, fog, lights, orbit controls |
| `src/components/SidePanel.jsx` | Sliders, shaping dropdown, simulation controls |

`createField()` in `src/lib/field.js` is the single source of truth: both the
map and the mesh call `field.sample(u, v)` with normalised 0..1 coordinates.

## Parameters

**Field** — `landform scale` (layer A frequency), `detail scale` (layer B
frequency), `detail amount` (blend of B into A, capped at 0.45 so B stays a
modifier), `seed`.

**Shaping** — an operation applied to the raw 0..1 field, plus one slider whose
meaning follows the operation:

| Operation | Slider | Effect |
|---|---|---|
| Raw | Contrast | expands / compresses around the midline |
| Power | Exponent | pushes the field down into broad basins |
| Ridge | Sharpness | folds the field at its midline into low banks |
| Terrace | Layers | quantises elevation into deposited layers |
| Fill | Fill level | floods everything under the level into flat tidal pan |

**Terrain** — `elevation` (displacement amplitude), `water level` (where the
tidal plane cuts the field), `grid resolution` (plane subdivisions, and the
sample count of the 2D map).

## Simulation

A rule-based cellular model on a fixed 128×128 grid, independent of the render
resolution and stepped at a fixed 30 Hz so behaviour does not depend on frame
rate. Each step:

1. **supply** — ground above the water line sheds a little material
2. **transport** — each cell pushes part of its mobile sediment to whichever
   neighbours have a lower total surface (`H + S`), eased by steepness
3. **diffuse** — a light blur, so accumulations read as soft banks
4. **settle** — sediment decays slowly, and submerged ground holds far more of it

A step can never move more than a cell holds, so the model cannot overshoot
however far the sliders are pushed.

Roughly what a run looks like at the defaults: sediment reads in the map within
2–3 seconds, covers a third of it by 5 seconds, and the basins overtake the
slopes at around a minute. Activity — the mint — is measured against the field's
own average flux rather than an absolute number, so it keeps marking the few
channels actually carrying material at every stage of a run instead of being
invisible early and everywhere later.

| Control | Meaning |
|---|---|
| Run / Pause | Advances or freezes the field in place |
| Reset | Clears everything that has settled |
| Flow speed | How fast mobile sediment runs downhill |
| Deposition | Fraction of sediment that refuses to move and settles |
| Sediment supply | How much material exposed ground sheds per second |

The simulation drives the sediment map, a pale tint and mint activity glow on
the terrain, and a small elevation lift (roughly 8% of the terrain's range at
full accumulation). It never reshapes the landform.

Press **W** to toggle terrain wireframe.
