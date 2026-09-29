# 02 · Sediment simulation

*Week 2. Something that moves across the landscape the first one made.*

**The assignment.** Add a simulation to the existing terrain: a dynamic field
with start / stop / reset, its own 2D map, a small number of meaningful
parameters, and a visual response in the 3D scene.

> 📸 **Screenshot needed.** Open the **Field** tab, press **Run**, let it go for
> about a minute, then capture the scene with the sediment map visible in the
> panel. Save as `docs/images/02-sediment-running.png` and place it under
> "Two things to look at".

## The idea underneath

The terrain from [study 01](01-noise-study.md) **does not change.** It stays
exactly as the noise made it.

Sediment is a **second, separate field** laid over the top — one that does
change, continuously, while you watch. Two fields in the same place: one fixed
and one moving.

That separation is the whole design. The landscape is the stage; the sediment is
what happens on it.

## Pipeline

```
height field
  → terrain
  → sediment simulation
  → accumulation / activity
  → simulation map + terrain material
```

## How the sediment behaves

Every step, in this order:

1. **Supply** — ground standing above the water line sheds a little material.
2. **Transport** — each patch pushes some of its loose sediment toward whichever
   neighbours sit lower, and does it faster on steeper ground.
3. **Diffuse** — a gentle blur, so what gathers reads as soft banks rather than
   as pixels.
4. **Deposit** — sediment settles and slowly disappears again, and low, drowned
   ground holds on to far more of it than exposed slopes do.

Nothing here is physics. They are four small rules chosen because together they
produce a legible story: **material appears on the high ground, streaks
downhill, and collects in the quiet basins.**

The simulation runs on its own fixed grid at a fixed rate, so it behaves the
same regardless of how finely the terrain is drawn or how fast the machine is.

## Controls

| Control | What it does |
|---|---|
| **Run / Pause** | Advances the field, or freezes it exactly where it is |
| **Reset** | Clears everything that has settled and starts over |
| Flow speed | How fast loose sediment runs downhill |
| Deposition | How much sediment refuses to move and settles instead |
| Sediment supply | How much material exposed ground sheds |

Pause is genuinely a freeze, not a slow-down — useful for reading a moment.

## Two things to look at

**The simulation map** is the sediment field on its own, seen from above, beside
the base field map from study 01. One shows the landscape; the other shows what
is currently moving over it.

**The terrain material** combines three things at once:

- **height** drives the base colour — deep indigo low, lavender mid, pale high
- **accumulated sediment** adds a pale tint and a very small lift
- **active flow** adds the sparse mint

So you can see where material has *ended up* and where it is moving *right now*
in the same glance. Activity is measured against the field's own average rather
than a fixed number, which keeps the mint marking only the few channels actually
carrying material — early in a run and late in one.

The sediment lifts the surface very slightly where it gathers, but it never
reshapes the landform. The terrain stays what the noise made it.

## Limitations

- The four rules are **chosen, not derived** — nothing here is physics, and the
  parameter values that produce a legible run were found by measuring output
  rather than from any model.
- The simulation runs on a fixed grid regardless of the terrain's resolution,
  so turning the terrain detail up does not make the sediment finer.
- Sediment never reshapes the landform, only tints and lifts it slightly. That
  was deliberate, but it does mean the traces are not yet *permanent* in the way
  the project direction eventually wants.
- Everything resets when the field parameters change. There is no way to carry
  an accumulated state across a change of landscape.

## What I took from it

The interesting part was not the rules but the *pairing* — a static field and a
dynamic one, read together. Accumulation only means something because there is
something unchanging to accumulate against. That relationship is what the rest
of the project is built on.

→ Previous: [01 · Noise study](01-noise-study.md) · Next:
[03 · Voxel study](03-voxel-study.md)
