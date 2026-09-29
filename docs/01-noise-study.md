# 01 · Noise study

*Week 1. Making a landscape out of one continuous function.*

**The assignment.** Sample a continuous noise function across a grid, visualise
it as a 2D map, apply shaping operations, and use the result to displace a 3D
grid — with controls for scale, detail, seed, shaping, and resolution.

> 📸 **Screenshot needed.** Open the **Field** tab and capture two views: the
> terrain from the default camera, and the side panel showing the Base field
> map. Save as `docs/images/01-terrain.png` and `docs/images/01-noise-field.png`,
> then drop them in below "Show it twice".

## The idea underneath

**Noise is a function, not a picture.** Ask it about any position and it hands
back a smooth number. Nothing is stored anywhere. So a "grid" is never the
thing itself — it is only a decision about *where* to ask.

That one fact explains most of what follows.

## Pipeline

```
position
  → noise layers
  → shaping
  → height field
  → 2D map / 3D terrain
```

## The steps

**Sample positions.** Walk a grid of points, ask the noise function at each one,
collect the answers. That collection is the field.

**Layer it.** Two layers of the same noise at different frequencies. A broad
**landform** layer does the big shapes; a finer **detail** layer adds grain. A
blend control mixes them, with detail deliberately capped so it stays a modifier
and can never take over the landform. A **seed** gives a completely different
field under identical rules.

**Shape it.** A shaping operation rewrites each value before anything reads it:

| Operation | What it does to the land |
|---|---|
| Raw | leaves it alone |
| Power | pushes it down into broad basins |
| Ridge | folds it at its midline into low banks |
| Terrace | quantises it into deposited layers |
| Fill | floods everything below a level into flat pan |

Same underlying field, completely different character. This is the step that
decides whether the result reads as dunes, terraces, or tidal flats.

**The height field.** What comes out the other end: one final height per
position. It is *static and reproducible* — the same seed and settings always
give exactly the same landscape.

**Show it twice.** The 2D map paints one pixel per sample, seen from above. The
3D terrain is a flat subdivided plane where every vertex asks the field for its
own position and moves up or down. These are not two similar things — they are
**the same numbers drawn two ways**, which is why a slider moves both at once.

**Resolution is how densely you ask.** It changes the sampling, never the field.
Low resolution gives a blocky map and a faceted mesh; high gives both smooth. It
is the same landscape underneath either way — you are just asking more often.

## Limitations

- The field is only ever a **surface** — one height per position. It cannot
  express thickness, an overhang, or anything with an inside. That limit is
  what study 03 goes after.
- Shaping is a fixed menu of five operations. They cover a good range, but
  nothing in the system *combines* them, so you pick one character at a time.
- Resolution is global. There is no way to sample densely where it matters and
  sparsely where it does not.

## What I took from it

Separating *the field* from *how it is drawn* was the useful move. Once the
height field became a single thing that several views read from, the map and the
terrain could not drift apart, and every later study — the sediment simulation,
then the voxel volume — could be built on top of it rather than beside it.

→ Next: [02 · Sediment simulation](02-sediment-simulation.md)
