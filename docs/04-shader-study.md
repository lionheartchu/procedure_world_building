# 04 · Shader study

*Week 4. Same world, different readings of it.*

**The assignment.** Explore shaders as alternative visual interpretations of one
procedural world, rather than as decoration on top of it.

> 📸 **Screenshots needed.** Open the **Shaders** tab and capture the same
> camera in each of the three modes. Save as `docs/images/04-geological.png`,
> `04-dormant.png`, `04-membrane.png` and place them under each section below.
> The comparison only works if the camera does not move between them.

## Question

How can the same procedural world be perceived differently through material and
shader strategies?

## Test setup

- the **Field terrain** as a fixed test object — the Volume study is still
  changing shape, so it would confuse the comparison
- same geometry, same camera, same scene, same simulation state
- **only the material mode changes** — Field and Shaders literally render the
  same component, so nothing can drift between them
- one `uMode` uniform branches the shader; mode 0 is the Field view and is
  untouched

Each mode reads a deliberately small set of inputs and changes a small set of
visual dimensions. That narrowness is the method: if two modes look different,
the reason should be obvious.

## A — Geological

**Reads:** height · normal · world position

**Changes:** colour ramp by elevation · warped bedding (tone per bed + thin
partings) · slope darkening for readability · wet darkening at the water line

No simulation state and no animation at all — this is the terrain as landform,
not as something in progress. Slope darkening does most of the work for
legibility: exposed faces drop in value, so the form reads without needing
stronger light.

**Controls:** height influence, strata strength

**First pass was too quiet.** Strata was a ±20% brightness ripple at about two
cycles across the whole terrain — at full strength it was barely visible, and
the slider read as broken.

**Refined.** Bedding now does three things at once: the ramp is *stepped* into
layers, a thin darker riser is drawn between them, and both scale with slope —
strongest on steep faces, which is where bedding is actually exposed. Added a
two-scale mineral grain (barely there, just so the surface is not flat colour)
and a wetness darkening near and below the water line.

**Third pass — still invisible.** Bands sat at a fixed 0.11 world units and
darkened by at most ~8% at default strength, so on screen there was nothing.
Now there are about twelve beds across the *relief* (scaled to elevation, so
any landform gets the same count). Each bed has its own value (±18%), with a
thin darker parting between beds, antialiased with `fwidth` and faded out
where it would alias. A slow noise warps the beds so they read as deposited
layers rather than as height contours.

**Observation:** *[after review]*

## B — Dormant / Residual

**Reads:** sediment · activity · time

**Changes:** brightness · pale residue tint · restrained mint on active flow ·
a slow spatial pulse

The ground starts dim and only lightens where something has happened on it, so
the terrain reads as mostly dormant with memory in it. The pulse is spatial
rather than global — it travels, so the surface never sits completely still and
never flashes as one.

The optional breathing is in: ground that has collected sediment displaces very
slightly, a few percent of the terrain's range. Only accumulated ground
breathes, which felt like the right rule. At pulse 0 it is completely off.

**First pass washed out.** High Glow / Pulse lifted the whole terrain, because
the residue used `pow(sed, 0.7)` — a curve that gives thin dustings a real
value. Everything had *some* sediment, so everything glowed.

**Refined.** Residue and pulse both sit behind a **threshold**
(`smoothstep(0.12, 0.62)`) rather than a curve, so a dusting reads as nothing
and only real accumulation lights up. Mint sharpened to `pow(act, 1.6)`.
Untouched ground now stays dark whatever the sliders say.

**Controls:** activity influence, glow / pulse (plus Run / Pause / Reset).
Entering the mode starts the simulation and leaving it stops again, since the
mode has nothing to show until material has moved.

**Observation:** *[after review]*

## C — Living Membrane

**Reads:** *smooth* normal · view angle · time · one low-frequency noise

**Changes:** broad sheen · wet highlight · thin-sheet transmission toward the
light · soft drift across the surface · very small displacement · denser
under water

This one barely reads the terrain at all. Colour comes from which way the
surface faces rather than from elevation, which is what stops the same geometry
being ground. Edges catch light as if the sheet were thin there. The noise is
three sines rather than a hash — no grain, and nothing borrowed.

**First pass looked like a wireframe.** At high Fresnel the surface turned into
bright white contour lines. The cause: the Fresnel was read straight off the
faceted derivative normal, so every facet silhouette lit up — the highlight was
literally tracing the mesh.

**Refined.** A slow low-frequency field pushes the normal around *before*
anything is measured against it. That decorrelation is the whole fix — light
now pools and slides instead of following edges. The falloff was also broadened
(exponent 1.7 rather than 3) and scaled well down, and a low-exponent specular
lobe was added on the same perturbed normal for a wet rather than glassy
highlight.

**Third pass.** Membrane now uses the mesh's *smooth* vertex normals, while
Geological and Dormant keep faceted per-fragment ones. That single change
separates it most from the other two: no facets at all, a skin rather than
ground. It also gets a small transmission term, so looking toward the light,
grazing parts of the sheet glow as if thin. Under water it darkens by up to
40%, because a material that is pale everywhere otherwise loses the waterline.

**Controls:** sheen strength, surface movement

**Observation:** *[after review]*

## Shared water layer

Not a fourth mode — the water belongs to the world, so it is shared and every
mode gets it. It is now three separate things, kept separate on purpose:

1. **Terrain material** — the selected mode, and nothing else.
2. **Water surface** — its own transparent mesh at the (tidal) water line.
3. **Caustics** — light the water throws onto shallow ground beneath it.

### What was wrong with the first attempt

A screenshot showed a strong glowing network across most of the terrain. It
read as luminous contour lines, or something cellular, rather than as water.
Four separate causes:

- **The pattern was literally a contour line.** Caustics were `1 − |a − b|`
  of two smooth fields, sharpened by a power. That is a thin line along the
  zero set of `a − b`: an isoline, drawn everywhere, with nothing sparse
  about it.
- **The mask was far too wide.** The only mask was "below the water line",
  softened to run 0.6 units *above* it. On the default terrain 79% of the
  ground is under water, and with that band included the mask covered
  **98.5%** of the terrain. There was no depth falloff at all, despite what
  this page previously said, and no normal test, so cliffs got it too.
- **It was additive and bright.** Half-strength pale lavender added on top of
  every mode, after emissive terms. On Dormant's dim ground that was the
  brightest thing in the frame, and nearly the same colour as the residue
  tint, so it posed as world state.
- **The water surface had nothing of its own.** It was a uniform ~45%-alpha
  dark plate with crossed-sine ripples, close in value to the ground beneath
  it and with no idea where the shore was. So it didn't read as a surface,
  and the network on the ground was the most legible thing in the scene.

### Now

**Water surface.** It knows its own depth: the ground height now rides in the
simulation texture's spare B channel, so the water can compute depth per
pixel. From that:

- it fades to nothing at the shore
- it is nearly clear over the shallows and carries more of its own colour
  over the basins
- it reflects the sky's own indigo-to-horizon ramp, weighted by a Schlick
  Fresnel, so near water is see-through and far water turns into sky
- one broad, dim glint
- the surface tilt is two very slowly drifting octaves of value noise: no
  sines, no vertex motion

Opacity is scaled per mode:

- **Dormant:** clearer, because its record mostly settles in the basins and
  shouldn't be hidden.
- **Membrane:** more body, because pale-on-pale lost the waterline.

**Caustics.** Two independent drifting value-noise fields are *multiplied*,
so light gathers only where both are high. That makes them sparse by
construction: about 12% of the area, as soft irregular patches, with a slow
domain warp so they don't look gridded.

The mask reads:

| Input | Rule |
|---|---|
| depth below the *tidal* water line | 0 at the surface, full by 0.05, gone by 0.45 |
| surface normal | only upward-facing ground (light falls from above) |
| mode | off in the Field view; ×0.4 in Dormant, so it never competes with residue |

Caustics are applied mostly as a multiplier on the already-lit surface, plus
a small additive floor, and never touch emissive terms. Every mode now writes
`lit` and `emit` separately, so caustic light cannot brighten mint, pulse or
sheen. Colour is a pale lavender, not white, and no mint.

The single **Water & caustics** slider is now two, **Water surface** and
**Caustics**, so the effects can be judged apart.

### Limitations

- The water's depth comes from a 128-cell, 8-bit copy of the ground, so
  the shoreline is approximate. The fade is offset to hide the mismatch,
  but the true edge is still the depth-test intersection.
- The water does not know about Dormant's breathing or Membrane's
  displacement, both only a few hundredths of a unit.
- The reflection is a gradient, not the scene: no terrain in it.
- The caustic depth band is in world units, tuned for the default elevation.
  At a very different amplitude, the shallow shelf will grow or shrink with
  it.

### Second pass: water scale

The first surface still read as a sea with the terrain as islands in it —
two mismatched layers rather than one world.

- **Scale.** The plane was 7× the terrain's width (182 vs 26 units, 49× the
  area), and everything beyond the field was forced to "deep", so it drew
  an opaque ocean out to the horizon.
- **Opacity.** Deep water reached ~75% opacity, which hid the basins'
  landform entirely; only the peaks were left, as islands.
- The depth itself was not the problem: shoreline and opacity already came
  from local terrain depth (128-cell, 8-bit, bilinear), with no UV or height
  mismatch worth mentioning.

**Now** the study water is exactly the terrain's footprint and fades out
over the last 6% of it, so it never shows a square edge or extends past the
ground. Opacity runs 14% over the shallows to 46% over the deepest basin, so
the basin floor always reads through. The water is a veil pooled in the
terrain's low ground, not a sheet the terrain sits in. (About 79% of the
default field is below the water line — that is the Field's *water level*
parameter, not the shader, and is untouched here.)

The **Field view's own water is unchanged**: it is still study 02's large
plane.

### Shaders → Field bug

Going Shaders → Field directly painted the Field view pale white, while
Shaders → Volume → Field was fine.

**Cause.** Field and Shaders share one `Scene` and one `Terrain`. The two
water meshes were the two branches of a ternary, both a bare `<mesh>` at the
same position in the tree, so React *reused* the same mesh across the
switch. The study branch passes `material={waterMaterial}`; the Field branch
doesn't. When that prop disappeared, react-three-fiber "reset" it to its
default — `new Mesh().material`, a white unlit `MeshBasicMaterial` — and
that overrode the Field's `<meshStandardMaterial>` child. The pale gradient
was that white plane fading into the fog, not the renderer background.
Going through Volume unmounts the whole `Scene`, so Field remounted clean.

**Fix.** Each water mesh has its own `key`, so switching unmounts one and
mounts the other; nothing is carried over. The terrain material needed no
change: every shader-only uniform (`uMode`, `uCaustics`) is written every
frame from the current tab, so Field always gets mode 0 with caustics off.

**Simulation.** Dormant auto-runs on entry. Leaving it — for another mode
*or another tab* — now always pauses, so nothing the Shaders tab started
keeps running in Field. A run started by hand in Field is not affected by
entering Shaders.

### Third pass: why the light control did nothing

Screenshots at Caustics 0 and 1 were almost identical. The whole path was
checked, and the control itself was fine: slider → state → `uCaustics` every
frame. The problem was the masks, which multiply:

- a **depth band** of 0–0.45 world units: a thin ring along each shore
- a **facing threshold**, `smoothstep(0.45, 0.9, n.y)` on the *faceted*
  normal, which on rough terrain rejects much of that ring
- a **pattern** covering about 12% of the area

Measured on the height field, their product reached **2.4%** of the default
terrain and **1.3%** of a rougher one. That little was then half-hidden by the
water veil, darkened by Geological's wet band, and compressed by tone mapping.
No gain could fix it; the effect had almost no area to act on. The band was
also in absolute units, so it shrank as the relief grew.

**Replaced, not retuned.** "Caustics" became **water light**: reflected light
drifting through the basins. It is one field, used by both the ground and the
water surface.

- **Pattern:** broad patches a few units across, about a third of the area,
  heavily and slowly domain-warped so their outlines drift. A finer grain
  inside makes them shimmer rather than sit.
- **Reach:** every submerged surface, fading with depth *as a fraction of
  the relief* (`exp(−3.5·depth/elevation)`). It also climbs a short way up
  the banks (6% of the relief), where light off water is most visible in
  reality. Both sides are at full strength at the waterline, so there is no
  seam there.
- **Receiving:** a soft facing weight (35–100%) from the smooth normal, so
  facets no longer speckle it.
- **Surface:** the water carries the same field faintly, so the light below
  and the sheen above move together.
- **Mode gains:** Dormant ×0.45, Membrane ×0.55, since pale material
  amplifies it.

Measured the same way, reach is now about **10%** of the terrain, on either
landform, at a *lower* per-pixel gain than before.

**Water.** Shoreline and depth response are relative to the relief too. The
**Water surface** control now runs all the way to nothing (it used to bottom
out at 35%), so the light can be judged with no veil over it.

**Observation.** The reflected light did more for "this is water" than the
water surface ever did. A drifting patch of light on the basin floor places
the water in the terrain. The surface on its own only ever read as a layer
over it.

**UI.** Slider thumbs sat off their line. The 1px line was the `<input>`
itself, so the 9px thumb overflowed it, and WebKit pins an overflowing thumb
to the top edge. The input is now a transparent 13px box: the line is drawn
by the track pseudo-elements, and the thumb is centred with
`margin-top: -4px`.

## The Reset flash

A screenshot showed the whole terrain flashing mint on Reset. It was a real bug
in the *simulation*, not the shader, and it had been there since the activity
measure was written.

Activity is normalised against the field's own average flux, held in a smoothed
average with a two-second time constant. That average started at **zero** after
a reset, so for the first second or so the reference sat pinned at its floor —
roughly an order of magnitude below the true value — and every cell with any
flux at all saturated to full mint.

Measured: cells above half activity peaked at **14.8%** about a second in,
against a steady state of 4.8%. Two fixes — seed the average from the first
step instead of easing up from zero, and fade activity in over 2.5 s, which is
exactly the window in which nothing has happened yet. Peak is now 5.7% and
rises smoothly instead of spiking.

## D — Dream Filter

Not implemented. A future **post-processing** study, deliberately after the
material modes rather than before them — a global filter would flatter all three
equally and make it harder to judge whether the materials themselves work.

Potential inputs: the final rendered scene · depth · brightness

Potential effects: bloom · atmospheric haze · colour grading · restrained grain ·
very subtle chromatic drift

## Notes

- Mode 0 (the Field view) is left exactly as it was, so the shader study cannot
  regress the earlier studies.
- Mint stays only in mode B, on active flow. Mode C's edge glow is pale lavender
  instead, so the scarcity rule survives.
- Both displacements are tiny on purpose. Geometry stays comparable between
  modes; the material is what is being studied.
- The Field view keeps its original water. Only the shader study uses the
  shaded surface, so study 02 cannot regress.

**Which language feels most promising so far:** Dormant / Residual, because it
is the only one whose appearance is *earned* — what you see is a record of what
the simulation did, which is the project's whole premise. Geological is the most
readable and will probably stay the default for looking at terrain. Membrane is
the most beautiful and the least tied to anything; it needs a reason to exist
beyond looking good, and the likeliest one is thickness — feeding it something
real to be thin *about*.
