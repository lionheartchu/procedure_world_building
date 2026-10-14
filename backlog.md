# Backlog

Open work, by kind. Reorganised on 14 October 2026 from the earlier
study-by-study list. Each item says how it is known:
- **measured / confirmed:** checked in code or captures
- **diagnosed:** the cause is known, not fixed
- **observed:** seen in review

The full context is in the
[project status report](docs/project-status-2026-10.md) and
[architecture](docs/architecture.md#known-limitations-deferred).

## Confirmed technical bugs

- [ ] **The air's floor lies below the visible ground** (measured, diagnosed).
  - Haze, dust, wisps and fragments use a coarse 96-cell, 8-bit floor
    without the sediment lift: a median 7–9 cm below the drawn ground, and
    up to about 0.25.
  - The haze is composited without a depth test, so mist inside the ground
    is painted onto it. Colonies do not occlude it either.
  - This is the main cause of the haze reading as a separate layer from low
    angles.
  - Fix: build the floor from the ground as drawn, or give the haze scene
    depth ([09](docs/09-composition-and-light.md#layering-and-boundary-diagnosis)).
- [ ] **Stream water breaks up at grazing angles** (confirmed in captures).
  From a low camera, small terrain facets occlude the level ribbon and its
  visible footprint becomes a dashed line. Ordinary views are continuous.
- [ ] **Geometric discontinuities at stream mouths** (confirmed).
  - A dark faceted ledge where the sediment lift steps down at a delta's
    front, under the water.
  - The ribbon's jagged outline against faceted ground.
  - Where the record lifts the ribbon near the water line it now fades out.
    That removed a floating plate, but the stream ends abruptly there
    ([09](docs/09-composition-and-light.md#water-pass-the-stream-artifact-and-underwater-visibility)).
- [ ] **The base edge hangs below the rim** (measured). The misty edge
  follows the field without the sediment lift: a median 10 cm and up to
  22 cm below the visible rim.
- [ ] **Water depth is coarse** (measured). It is read from an 8-bit,
  128-cell height, giving shore steps of 2–7 cm.
- [ ] **Minor: forms near steep stream banks** (measured). The 224-cell terrain
  mesh differs from the exact ground the forms stand on by up to 7 cm there
  (a median of 1.3 mm elsewhere).

## Visual and spatial issues

- [ ] **The square terrain boundary.** The world is an obvious slab from
  high and wide views and some close ones.
  - **Direction (decided):** move away from a square slab toward an
    organically gathered landform whose edges pass into the surrounding
    atmosphere.
  - No geometry solution is prescribed and nothing is scheduled. Not to be
    fixed by restricting the camera.
- [ ] **The flat water plane.** Seen edge-on, the veil and its sheen form a
  horizontal band with a long straight waterline (diagnosed). Soften the
  edge-on sheen.
- [ ] **A grey, washed-out feel** (observed, study 07). Recover depth and
  contrast between terrain, membranes and atmosphere, without more
  saturation and without going darker or bluer.
- [ ] **Uneven integration of terrain, membrane, water and air** (observed).
  It is strongest around colonies and weakest at the water and in the haze;
  it overlaps the three items above.
- [ ] **The submerged floor stacks several darkenings** under the veil
  (measured). Explore's Underwater visibility lifts it on request; the
  default is unchanged.
- [ ] **Light and forms around the first colony** (observed, study 09):
  - the ground light is subtle at a distance
  - Bridgework's dark arches stand out
  - the smallest veils can go almost white at the base
- [ ] **Some worlds carry little life** (observed, study 09). A weak
  separate group no longer forms.
- [ ] **The streams read as a layer** placed on the terrain, not as a
  landform (study 06, paused).
- [ ] **Stream ripples ignore the flow direction.** They follow the ribbon's
  across/along coordinates, not the local flow. The time shear that turned
  them into bands is fixed and was verified over an hour of running.
- [ ] **The air does not follow Growth.** Colony air and haze are present
  before the colonies have emerged.

## UI and interaction

- [ ] **Explore cannot show time passing.** History is a slider that
  recomputes a different record; Growth replays fixed forms. Consider a way
  to watch the record accumulate.
- [ ] **Camera.** It is orbit-and-zoom only, and the default view is centred
  on the world, so gatherings elsewhere are framed as empty ground.
  Consider camera presets or guided views.
- [ ] **Dependencies are explained only in tooltips,** which touch devices
  cannot show.
- [ ] **Studies 06–08 as overlays in Explore** (streams, air, branching
  views): an idea, not started.
- [ ] **The Library needs Firebase and a Google sign-in.** Without
  configuration, saving is unavailable.

## Architecture, performance and maintenance

- [ ] **Commit the work since 7 October** (171 changed or untracked paths),
  and decide whether to update the public build. residual-ecology.web.app
  serves a late-September build with only the Field and Volume views.
- [ ] **Regeneration runs on the main thread** (about 0.2 s of pipeline
  plus about 0.3 s of branching and geometry, measured). Move it to a
  worker; that would also make branching on every colony affordable.
- [ ] **No automated tests.** Turn the determinism fingerprints and the
  frozen-clock captures used in passes into a small regression suite.
- [ ] **Control definitions** are shared by export from the study panels;
  move them into their own module.
- [ ] **One JavaScript bundle of about 1.9 MB.** Vite warns about its size;
  consider code-splitting the studies.
- [ ] **Frame rate has never been measured** across devices.
- [ ] **Lint reports 38 warnings** (no errors), mostly the per-frame updates
  of shader uniforms. Decide whether to configure the rule rather than
  rewrite them.
- [ ] **`Shard : residue language.png`** has a colon in its name and cannot
  be checked out on Windows.
- [ ] **Screenshots for studies 01, 02 and 04** were never captured; each
  document says what to grab.

## Future creative and conceptual explorations

- [ ] **The next look:**
  - dreamy, luminous, predominantly violet, lavender and lilac, with pearl
    and subtle iridescence
  - more breathing room and lightness, not deeper shadows or stronger blue
- [ ] **Water that carries light:** soft reflective patterns, openness and
  immersion in the spirit of *Journey*, in lavender and pearl rather than
  cyan.
- [ ] **Revisit the haze palette.** The palette pass made it slightly cooler
  and bluer; try pearl and lilac.
- [ ] **Air:** flakes turned by the air around them, rather than a scripted
  spin.
- [ ] **Feedback:** colonies adding to the record, so a second generation
  reads the first one's residue. Today the chain runs one way.
- [ ] **Decay:** colonies that thin and collapse into residue that seeds
  what follows.
- [ ] **A live history in Explore:** the record and the colonies developing
  over minutes rather than being recomputed.
- [ ] **The volume study's spanning structures** as undersides or cavities
  of the shared ground.

## Deferred or superseded

- **Branching and tissue (study 08): kept as an exploratory close-range
  study on one colony, with no further development for now** (decided).
  Its open notes stay on record in [08](docs/08-branching-study.md) for a
  later revisit:
  - the touchdown reads as 3D fibres meeting a flat map
  - the strands are shaped rather than grown
  - it is quiet at normal distance
  - extending it to every colony, and linking colonies, would cost about
    0.3 s per colony
- **Study 06, paused:** choosing stream sources from stronger world logic
  (thickness and topography, catchment, the accumulated record, colonies).
- **Superseded:**
  - the initial course backlog (v0): explored through studies 01–09
  - the particle study's first and second passes: the all-at-once resident
    ecology, kept at commit `cf0431d`, superseded by the phased rework
- **Rejected or removed, kept in the study records:**
  - the first branching (bright lines over the terrain)
  - the halo mesh around colonies
  - the cleanup toward ultramarine ground and icy-blue mist (reverted)
  - the first, too strong Underwater visibility (revised)
- ***Nimbus*, the storm prototype the repository began as:**
  [`style-guide.md`](docs/style-guide.md), marked superseded.

## Recently completed

Recorded in the study documents. "Under review" means the work is done but
not yet approved.

- **Air rework, phases 1–6** ([07](docs/07-air-study.md)).
  - Approved: dust, residue carried by moving air, colony air.
  - Accepted for now: haze, fragments.
  - Integration: a checkpoint.
- **Branching** ([08](docs/08-branching-study.md)): the tissue map and the
  transition experiment, as a checkpoint on one colony.
- **Composition and light** ([09](docs/09-composition-and-light.md)), all
  under review:
  - gathering colonies and light held in matter
  - the palette pass
  - the water pass. The stream's striped water (a time shear) and its
    floating end are fixed, verified in captures up to an hour of running.
- **Interface** ([architecture](docs/architecture.md)), under review:
  - Explore and Studies
  - regeneration on release, all at once
  - the panel's sections, tooltips, and Underwater visibility
- **References:** external references and AI-generated concept studies
  separated ([references](docs/references/README.md)).
- **Checkpoint decisions (14 October 2026):**
  - The project's name is **Residual Ecology**.
  - [`AESTHETIC_LANGUAGE.md`](AESTHETIC_LANGUAGE.md) is public, tracked and
    reconciled with the current direction.
  - Mint stays a rare, optional accent.
  - *Annihilation* is a conceptual inspiration only, with no image by
    intent.
  - The boundary direction is recorded.
  - Branching is paused as a close-range study.
- **Study 03 screenshots** cropped to the app content, removing the
  browser's tabs and bookmarks. The uncropped originals remain in Git
  history from September.
