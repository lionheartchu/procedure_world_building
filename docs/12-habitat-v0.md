# 12 · Habitat v0

*Explore's world as a place to be in: first person, one curated world,
its own page.*

> **Status, 29 October 2026: a playable prototype for review.** Local only;
> nothing committed or deployed. Explore, the Studies, the Atlas and the
> `?presence=1` / `?lifecycle=1` studies are unchanged.

## Running it

`/habitat/v0` (locally: `http://localhost:5173/habitat/v0`; it was `/habitat`
until that route became the featured Habitat's). The camera drifts
down from above onto the islet between the two places.

| | |
|---|---|
| **Drag** | Look around |
| **W A S D**, arrows | Drift |
| **Q / E** | Lower, rise |
| **Shift** | Faster |
| **Scroll** | Edge closer or back |

`?dpr=2` renders at Explore's pixel ratio, for measurement only.

## The place

The default world (seed 42, colony seed 7, 40 s of History), pinned in
`lib/habitat.js` so a change to Explore's defaults never moves it.
- **South:** colonies 0–2 gathered into one place, with lifecycle patch A.
- **North:** colony 3 alone on a bank, with patch B and the encounter.
- **Between:** a shallow basin, an islet and a peninsula, about 15 units:
  some 20 s of drifting. Colony 3's anchor shows over the ridge from the
  islet.

## Autonomous, reactive, static

| | What | Where |
|---|---|---|
| **Autonomous** | Two lifecycle patches, each its own `Lifecycle` with its own residual grid. A: colony 0, study 10's patch unchanged. B: colony 3's one free veil, first holding 90 s, so they are out of step from the start. They never exchange matter; their colonies are 17 units apart. The air (dust, wisps, haze) | `lib/lifecycle.js` (now takes `colony` and `holds`) |
| **Reactive** | One veil of colony 3 yields to the visitor: a damped dent centred where it is touched, the sheet leaning back with it. It eases the approach, stiffens toward its limit, and springs back past rest. It reads only the visitor; nothing reads it | `lib/encounter.js`, `components/EncounterVeil.jsx`, the form shader's `ENCOUNTER` block |
| **Static** | Landform, History, colonies, the residue between them, and the far field | |

**Transitional forms.** `strayResidue` (`lib/scatter.js`) places a few
strands of residue where nothing gathers matter and the water would have
left it: far from colonies, in the tide band, on thick record, with the
residue's own ground rules. On the default world there are six, mostly on
the northern shores; one sits by the peninsula's tip. They don't follow a path.

**Far field.** `lib/farField.js` continues the base landform past the
slab. The base field is plain noise, defined everywhere. It eases from the
slab's rim over 4 units, then sinks and flattens into shallows. Its ground
is a plain lit shader (`components/FarField.jsx`). Its water is the slab's
own water material, with the depth taken from the far ground (Terrain's
`FAR` define). Both thin into the sky's horizon between 45 and 80 units.
The visitor cannot reach it (the drift bound is still ±11.6).

**Carriers vs. ambient air.** The air's own skins (`AirFragments`) are left
out of the Habitat, so every film in its air is a lifecycle film carrying
matter. Carriers show their load as a pearl silt region with grains
(`CARRIER` in the film shader), leave a short sinking wake of motes along
their path, and fade only within 0.35–0.9 units of the camera. The warm
accent (variant 1, edge) marks release, landing and uptake.

**First-person rendering.** Pixel ratio capped at 1.5, no drawing buffer
kept, no orbit controls. Films get study 11's near-camera fade (rim and
fold light fade within 0.8–4 units) behind a `NEAR_FADE` define.

## Checked

| Check | Result |
|---|---|
| Patch A after the `colony`/`holds` change | Identical to HEAD (Node hash over 600 s) |
| Rendering and the visitor change nothing | Two browser runs to 3,000 steps (300 s): pixel ratio 1.5 with the visitor idle, and pixel ratio 2 with the visitor pressing the veil 12 times. Identical hashes for both patches |
| Habitat and Node | Patch B identical. Patch A: identical events and residual; film positions differ below 10⁻⁵ (Chrome vs Node's engine) |
| Encounter (Node) | Peak dent rises with approach speed: slow 0.079, normal 0.108, fast 0.142 (limit 0.204). Fast hits spring back past rest. The visible surface stays 0.27–0.30 from the eye (body 0.30, near plane 0.1) |
| Long run | 73 s at ×4 (300 simulated s): heap flat (198 → 181 MB), textures and programs constant, geometries growing only by new residents |
| Explore | Defaults moved to `worldDefaults.js` verbatim (checked against HEAD). Default view renders, no console errors. Build passes; lint has no errors |

**Performance** (Apple M4 Pro, Chrome, 1512 × 799 CSS px, GPU timer
queries, 6 s each, mean / p95 ms GPU; every run at the display's 120 Hz):

| Viewpoint | Explore + presence, ratio 2 | Habitat, ratio 2 | Habitat, ratio 1.5 (shipped) |
|---|---|---|---|
| Colony 0 (Explore's arrival) | 6.5 / 9.7 | 7.6 / 12.0 | 5.4 / 5.7 |
| The islet, looking north | 4.8 / 6.7 | 5.5 / 5.7 | 4.5 / 5.3 |
| At the encounter | 4.6 / 5.2 | 5.7 / 6.0 | 4.5 / 4.8 |

CPU per frame stays under 2.2 ms p95 in all cases. The first Explore
measurement at colony 0 read 5.7 / 8.5, so run-to-run variance is about
1 ms.

## Limitations

- **The patches wind down,** as study 10's did: A rests at about 500 s, B
  at about 360 s. After that the world holds its traces (contours,
  deposits) and only the air moves. No supply was added, by design.
- **Residents can be passed through.** They change shape, so they are not
  in the presence's forms. Patch B's resident stands 1 m from the
  encounter veil, which is solid and yields; the contrast may confuse.
- **Carriers are still faint against pale ground.** The wake carries most
  of the reading. Not checked: how readable a release is from across the
  basin.
- **The encounter's veil is small** (0.64 tall). Its dent is seen mostly
  as the sheet leaning and thinning, not as a hollow. When the dent's
  centre trails a sliding touch, the visible sheet can come 2–3 cm inside
  the body.
- **Not measured:** sessions over 10 minutes, other GPUs, and a real
  display's feel (all checks were scripted).
