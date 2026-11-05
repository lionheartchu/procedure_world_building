# Residual Ecology — project status, October 2026

A consolidation of what the project has become: what it explores, how the
current system works, what has been learned, what is unresolved, and where
it could go. Written from the repository as it stands on 14 October 2026,
after reading the code, not only earlier plans. The detailed research logs
stay in the study documents ([01](01-noise-study.md)–[09](09-composition-and-light.md));
this report links to them rather than repeating them.

**State of the repository.**
- **The last commit is `cf0431d` (7 October, the air study's baseline).**
  Everything since is uncommitted: the air rework's later phases, studies
  08 and 09, the Explore interface, the water pass, the references and most
  of the documentation.
- **The public build at residual-ecology.web.app is older still.** Its
  bundle offers only the Field and Volume views, roughly the state of study
  03 in late September. Explore and everything after exist only in local
  builds.

---

## A. Current project identity

### What it explores

Residual Ecology is a procedural world built around one question, carried
since the first week:

> How can a procedural world reveal its own history through the traces its
> systems leave behind?

It works with matter that collects, settles and stays: sediment laid down
over time, colonies that gather where that record is thick, the material
those colonies hold, and the light and air around it. The interest is
less in any single organism than in how a place comes to look the way it
does because of what has happened there. The world should read as one
connected body, with recognisable structures up close and an ambiguous,
continuous whole further away.

### Traces, accumulation, history, ecology — as implemented

The concept describes a loop: traces change conditions, and conditions shape
what comes next. The implementation realises **one pass of that loop, in one
direction**:

1. **The landform** (noise, shaping, relief) and the **water veins** carved
   into it set the conditions.
2. **A sediment record** is laid down on that ground by a small rule-based
   simulation, run for a chosen number of seconds before anything grows.
3. **Colonies** form where the ground and the record allow. Their size and
   "maturity" are read from how thick the record is.
4. **What the colonies hold** (their bases, residue, heaps) gives off light
   through the record around them, grows a tissue (one colony), and bends
   the air.

Nothing flows back. Colonies do not add to the record, their residue does
not change the next colony's placement, and the air deposits nothing. The
world shows the result of a history; it does not yet keep making one.

*(Update, 15 October:* a bounded experiment behind a development flag now
closes the loop for one membrane of one colony; see
[study 10](10-lifecycle-concept.md#prototype-15-october-2026). Explore as
shown is unchanged.*)*

*(Update, 17 October:* it is now a stages 0–2 demo on one patch of one
colony. Staggered residents release matter that settles as visible residue,
and new residents form on it and take it up; see
[study 10](10-lifecycle-concept.md#stages-02-demo-17-october-2026). Still
behind the flag.*)*

*(Update, 24 October:* paused. Stages 0–2 are a bounded demo. A shared
tissue between colonies (`&conduit=1`), with its fold and greybox studies,
is unfinished and paused. Feedback to residents, an emergent core and a
history kept between sessions are proposed, not implemented. Explore is
unchanged.*)*

### How the concept has evolved

- **From storm to sediment.** The repository began as *Nimbus*, a storm
  prototype; its UI rules survive only in [`style-guide.md`](style-guide.md),
  marked superseded. The project then took the working name *Trace
  Habitat*, and became *Residual Ecology*.
- **From studies to one world.** The weekly studies began as separate tabs.
  Since study 06 they all render one shared world, and since the Explore
  pass the app opens on that world as a whole
  ([architecture](architecture.md)).
- **From props to colonies.** Scattering assets over suitable ground read as
  placed objects. Colony formation replaced it: sites gather, members grow
  around an anchor, and residue follows the record
  ([05](05-scatter-study.md), [09](09-composition-and-light.md)).
- **From lit objects to lit matter.** A glow mesh around colonies was removed.
  Light is now a property of accumulated matter, seeping through the
  sediment record ([09](09-composition-and-light.md)).
- **From dark and uncanny toward luminous.** The September notes asked for
  deep shadows, dark silhouettes and a slightly creepy mood. The October
  reviews moved toward a lighter, luminous lavender, and explicitly rejected
  a pass that went darker and bluer. See [Visual direction](#visual-direction)
  below.

### Visual direction

The visual direction is exploratory. What is confirmed by review decisions
is separated here from what is historical and what is still open.

**Confirmed in review (October 2026):**
- **Dreamy, hazy, softly luminous.** Breathing room and lightness.
- **Violet, lavender, lilac and pearl**, with subtle iridescence.
- **Translucent, ambiguous, half-formed materials.**
- **One interconnected landscape,** not an assembly of separate objects.
- **Residual matter** that accumulates, changes and becomes part of a larger
  ecology.
- **Muddiness is not fixed by going darker or bluer.** A cleanup toward
  ultramarine ground and icy-blue mist was rejected and reverted
  ([09](09-composition-and-light.md#cleanup-pass-rejected-and-reverted)).

**References and what each is for** (the files are in
[`references/`](references/README.md)):

| Reference | Role | Notes |
|---|---|---|
| Sabrina Ratté, *Plane of Incidence* | Primary visual inspiration | Translucent, ambiguous materiality; accumulated organic structure and micro-detail; forms continuous with their surroundings |
| *The Ephemeral Lake* | Secondary, conceptual and spatial | Traces of time, impermanence, a form and its environment. Artist not recorded |
| *Journey*, *ABZÛ* | Atmosphere | From *Journey* especially, the luminous water and atmosphere: soft light, delicate reflective patterns, spatial openness, immersion. **Not** its cyan-blue palette, and not either game's forms |
| *Annihilation* | Conceptual inspiration only | No image is kept in the reference folder, by intent |
| AI-generated concept studies | Earlier direction-setting mockups | Records of exploration, not requirements ([`references/concept-studies/`](references/concept-studies/)) |

**Historical, not binding** (the September framing in
[`PROJECT_DIRECTION.md`](../PROJECT_DIRECTION.md), and the September
version of [`AESTHETIC_LANGUAGE.md`](../AESTHETIC_LANGUAGE.md), now public
and reconciled):
- **Mood:** deep shadows, dark silhouettes, "slightly creepy".

**Mint** remains a rare, optional accent. It is still in the code, for
active sediment and some air residents.

**Open to experiment:**
- **The water.** How it can carry Journey-like luminosity and reflective
  pattern in lavender rather than cyan has not been tried.
- **The haze's colours.** The palette pass made them slightly cooler and
  bluer ([09](09-composition-and-light.md#palette-pass-cleaner-darks)),
  which sits uneasily with the confirmed direction.
- **The world's edge.** The recorded direction is away from a square slab,
  toward an organically gathered landform whose edges pass into the
  surrounding atmosphere. No geometry is prescribed, and nothing is
  scheduled.
- **How dark the darks should be.** "Not darker" is confirmed; how light is
  not.

---

## B. Current system

### Views

The app opens on **Explore**: the whole world, with a short panel. The
weekly studies sit behind a **Studies** menu, each still its own view on the
same state:
- **Field:** the terrain and the live sediment simulation.
- **Volume:** a separate volumetric world.
- **Shaders:** three material readings.
- **Scatter:** the colony rules, one language at a time.

Details in [architecture](architecture.md).

### The pipeline

```
 landform: noise + shaping (world seed, scale, shaping)
   └─► relief, built around the water level
         └─► water veins: traced downhill as splines, then carved into the ground
               └─► the carved field ── terrain mesh, water plane, air floor
                     │
                     ├─► live sediment simulation        (Field, Shaders only; real time)
                     │
                     └─► HISTORY: the same model, run headless for N seconds  (precomputed)
                           └─► world data: shore, slope, hollow, record, flow, colony field
                                 └─► colonies: sites, then members and residue  (deterministic)
                                       ├─► forms and the ground's tissue
                                       ├─► branching network (the first colony only)
                                       ├─► accumulation light, through the record
                                       └─► colony air: the particle field bends around them
```

The full, verified dependency diagram and a per-control table are in
[architecture](architecture.md#the-world-derived).

### What evolves over time, and what is computed

This is the distinction most easily overstated.

| Process | Kind | What that means |
|---|---|---|
| Live sediment simulation | **Evolves in real time** (stateful, 128² cells) | Runs only in Field and Shaders, with Run / Pause / Reset. Explore never runs it, and it never changes Explore's world |
| History | **Precomputed, deterministic** | The same model run headless (40 s of history is about 100 ms) whenever its inputs change, always from nothing. Same inputs, same record |
| Colony placement, maturity | **Computed, deterministic** | A function of world data and seeds. No agents, no simulated age: "maturity" is read from record thickness and site strength |
| Growth / Grow | **Replay** | A 42-second clock revealing the placed forms, tissue and light: *when* they appear, never *where* |
| Branching (L-system) | **Computed once per placement** | Grown on the strongest colony only, then revealed by the growth clock |
| Accumulation light | **Computed once per placement** | 200 diffusion steps over the record; read by the ground, the tissue and the forms |
| The air | **Evolves in real time** (stateful) | 16,384 GPU particles advected each frame by a procedural flow field; colonies bend and slow it. The one continuously evolving system in Explore. It writes nothing back |
| Water, tide, ripples, breathing membranes | **Time-driven animation** | Cyclic shader motion, not state |
| Lifecycle (study 10, dev flag only) | **Evolves in real time** (stateful, seeded) | Staggered residents of one patch lie down and release films; the air carries them; a live residual records and shows what settles; new residents form on it and take it up. Off by default |

So Explore shows a **world recomputed from parameters and a precomputed
history**. It is animated and its air is alive, but its ecology does not
develop while it is watched.

### What changes when parameters change

From [architecture](architecture.md#what-each-explore-control-does), in
short:
- **Regenerates the world** (on release): world seed, landform, elevation,
  water level and water veins. Elevation and water level are not visual
  scales: both reshape the land and move streams and colonies.
- **Rewrites the record** (on release): History and the record's rules
  (flow, deposition, supply). The ground stays; colonies are placed again.
- **Regenerates the colonies** (on release): colony seed and the languages'
  amounts. Colony sites move only with the colony seed, History, the
  landform and the water.
- **View only** (live): Growth, membrane openness, the air, Underwater
  visibility.

### Interconnected or layered

**Genuinely interconnected, through data:**
- the landform shapes the streams
- the streams are carved into the landform, then into the record
- the record decides colony sites, sizes and residue
- colonies shape the light, the tissue and the local air

Colonies avoid streams. Forms stand on the exact ground the record lies on;
the mesh matches it to a median of 1.3 mm.

**Visually layered, aligned only approximately:**
- **The haze and dust.** Their floor is the carved field without the
  sediment lift, at coarse resolution. The haze is composited without a
  depth test.
- **The water plane.** One flat veil, with its own 8-bit depth.
- **The base edge's mist.**
- **The shader readings.** Interpretations of one world, not processes.
- **The Volume study.** A separate world that is not connected to the
  rest.

---

## C. Technical and design development

### Studies and milestones

| | Study | What it established | Status |
|---|---|---|---|
| 01 | [Noise / height field](01-noise-study.md) | A landform from one continuous function, shown as map and mesh | Done; screenshots never captured |
| 02 | [Sediment simulation](02-sediment-simulation.md) | A second field moving over the first: supply, transport, deposition | Done; screenshots never captured. The model is still the basis of History |
| 03 | [Volume](03-voxel-study.md) | Two meshers; a scaffold (minimum spanning tree as a distance field) gave elongation, spans and nodes where noise gave sponge | Done; a separate branch, not part of the world |
| 04 | [Shaders](04-shader-study.md) | Three readings of one terrain (geological, dormant, membrane); the dormant reading became the world's ground | Done; screenshots never captured |
| 05 | [Scatter](05-scatter-study.md) | Rules over named world-data channels; the three languages; colony formation; base relief | Done; refined in 09 |
| 06 | [Water veins](06-passages-study.md) | Terrain → spline → carved terrain, in the shared world | Paused; open issues (below) |
| 07 | [Air](07-air-study.md) | A particle ecology rebuilt in reviewed phases: dust, wisps, colony air, haze, fragments | Checkpoint; two open visual issues |
| 08 | [Branching](08-branching-study.md) | An L-system tissue map draped on the ground, plus strands from membranes into it | Checkpoint on one colony |
| 09 | [Composition and light](09-composition-and-light.md) | Gathering colonies; light held in matter; palette pass; water pass | Under review |
| — | [Architecture](architecture.md) | Explore and Studies; atomic regeneration; saved states | In use |

### Design decisions that shaped the system

- **One world for every view.** All tabs share one field, one mesh, one
  water and one set of streams, so they can never drift apart.
- **A boundary between world and rules.** Placement reads only named
  world-data channels (shore, slope, record, flow…), never the mesh or the
  simulation. Anything that can answer those questions could be populated
  the same way.
- **History as a pure function.** The record is recomputed headless and
  deterministically rather than taken from the live simulation, so a saved
  configuration always reproduces its world.
- **Colonies, not assets.** Forms belong to colonies, with a first, fuller
  colony and younger offshoots.
- **Light as a property of matter**, not a lamp.
- **Regeneration on release, all at once.** Explore never shows a half-built
  world.
- **Reviewed phases.** The air was rebuilt one layer at a time, each stopped
  for review.

### What worked, and what did not

**Worked:**
- **The scaffold** turned the volume from eroded rock into spanning
  structure ([03](03-voxel-study.md)).
- **Colony formation** made placement read as one organism rather than
  props ([05](05-scatter-study.md)).
- **Light diffused through the record** made gathering visible without a
  glow object ([09](09-composition-and-light.md)).
- **Deterministic fingerprints and frozen-clock captures** made visual
  changes verifiable pixel for pixel ([architecture](architecture.md#how-changes-are-verified)).
- **Diagnosing the stream's striped water** found a time shear in its
  ripples, not a geometry problem. The fix holds over an hour of running
  ([09](09-composition-and-light.md#water-pass-the-stream-artifact-and-underwater-visibility)).

**Did not work, or only partly:**
- **The volume's first morphology.** A thresholded "vein" noise read as
  scattered patches ([03](03-voxel-study.md)).
- **The first branching.** It read as bright lines laid over the terrain and
  was rejected. The tissue map that replaced it is quiet at normal
  distance ([08](08-branching-study.md)).
- **The halo mesh around colonies** was removed.
- **A cleanup toward ultramarine and icy blue** was rejected and reverted.
- **The haze** is still read as a separate horizontal layer from low
  angles. Its cause was found (a floor below the visible ground) but not
  fixed ([07](07-air-study.md), [09](09-composition-and-light.md#layering-and-boundary-diagnosis)).
- **The first Underwater visibility** was too strong (a milky film) and was
  revised before review.
- **The streams** remain a layer on the terrain rather than a landform
  ([06](06-passages-study.md)).

### What the implementation demonstrates

- **A chain of real dependencies.** Landform → streams → record → colonies
  → light, tissue and air, each step reading the one before through data.
- **Deterministic generation.** The same parameters give the same world,
  verified bit for bit across eight worlds.
- **A history becoming visible** as sediment, colony size, residue and light.
- **An atmosphere that responds** to the colonies in real time.

It does not yet demonstrate a world that changes itself over time, or
traces that feed back into what grows next.

---

## D. Current limitations

### Rendering and geometry

Measured or confirmed in captures. Details and figures are in
[architecture](architecture.md#known-limitations-deferred) and
[09](09-composition-and-light.md).

- **Air floor below the ground.**
  - The haze, dust, wisps and fragments use a 96-cell, 8-bit floor without
    the sediment lift, so they sit a median 7–9 cm below the drawn ground,
    and up to about 0.25.
  - The haze has no depth test, so mist inside the ground is painted onto
    it.
- **Stream water at grazing angles.** From a low camera the level ribbon is
  occluded by small terrain facets and breaks into a dashed line, confirmed
  in the water pass's captures (12 separate pieces in one low view). From
  ordinary views it reads continuously.
- **Stream mouths.**
  - A dark faceted ledge where the sediment lift steps down at a delta's
    front.
  - The ribbon's jagged outline against faceted ground.
  - Where the record lifts it near the water line, the ribbon fades out.
- **The base edge.** It hangs up to 22 cm below the rim.
- **Water depth.** It is read from an 8-bit, 128-cell height: shore steps of
  2–7 cm.
- **The flat water plane.** From low angles it reads as a horizontal sheet
  with a long straight waterline.
- **The square boundary.** The world is a visible slab from high and wide
  views. Not to be fixed by restricting the camera.

### Spatial integration and visual consistency

- **Haze and greyness.** The haze reads as a separate layer from low angles,
  and the scene can feel slightly grey and washed out ([07](07-air-study.md)).
- **The submerged floor.** It stacks several darkenings under the veil.
  Explore's Underwater visibility can lift it; the default is unchanged.
- **The tissue.** It is quiet at normal distance and exists on one colony
  only. It is kept as an exploratory close-range study, with no further
  development for now.
- **Forms and light.** The ground light is subtle at a distance. Bridgework's
  dark arches stand out around the first colony, and the smallest veils can
  go almost white at the base.
- **Some worlds carry little life.** No weak separate group forms. The
  default camera is centred on the world, so a gathering elsewhere is
  framed as empty ground.
- **Terrain, membrane, water and air.** They are lit and composited by
  separate systems, so their integration is uneven: strongest around
  colonies, weakest at the water and in the haze.

### Interaction and usability

- **Explore cannot show time passing.** The history is a slider: changing
  it recomputes a different record from nothing; nothing accumulates while
  you watch. Growth is a replay of fixed forms.
- **Regeneration holds the main thread** for about 0.5 s (about 0.2 s of
  pipeline plus 0.3 s of branching and geometry), which is why branching
  stays on one colony.
- **The camera is orbit-and-zoom only.** There are no presets or guided
  views.
- **Dependencies are explained only in tooltips**, which do not reach touch
  devices.
- **The air ignores Growth.** Colony air bends around colonies that have not
  emerged yet.
- **The Library needs Firebase and a Google sign-in.** Without configuration,
  saving is unavailable.

### Performance, maintainability and architecture

- **Version control.** Seven days of substantial work are uncommitted (171
  changed or untracked paths), and the public build is about three weeks
  behind.
- **Tests.** There is no automated test suite. Determinism and visual checks
  exist as scratch scripts used during passes, not as part of the
  repository.
- **Central state.** All state lives in `App.jsx`, and Explore's control
  definitions are shared by export from the study panels.
- **Lint.** It reports 38 warnings, no errors: mostly the React lint rule
  against mutating values passed to hooks, which is how the shaders'
  uniforms are updated each frame.
- **Bundle size.** The build is one JavaScript bundle of about 1.9 MB; Vite
  warns about its size.
- **Frame rate.** It has never been measured across devices. No
  performance figures beyond the rebuild timings above should be assumed.
- **A filename with a colon.** `Shard : residue language.png` cannot be
  checked out on Windows.
- **Resolved in this checkpoint:**
  - `AESTHETIC_LANGUAGE.md` is now public and tracked, so the links to it
    work.
  - The four study 03 screenshots, which showed the browser's tabs and
    bookmarks, are cropped to the app. The uncropped originals remain in
    Git history (committed in September) and in a folder outside the
    repository.

### Open experimental questions

- Should the world **change while it is watched**: a live history in Explore,
  rather than a slider?
- Should life **write into the record**, so one generation's residue shapes
  the next?
- Does the **Volume** study belong in the world (undersides, cavities), or
  stay a separate branch?

---

## E. Future development

### High-value improvements

In rough priority order:

1. **Checkpoint the work.** Commit the current state, and decide whether the
   public build should be updated.
2. **Align the layers to the ground as drawn.** This is rendering-only and
   measurable:
   - an air floor with the sediment lift, or scene depth for the haze
   - the base edge on the lifted rim
   - finer water depth
3. **Stream water.** Handle grazing views and stream mouths: the dashed
   ribbon, the delta-front ledge, the jagged outline.
4. **Rebuild off the main thread** (a worker). That would also make
   branching on more colonies affordable, if it is ever resumed.
5. **The world's edge,** in the recorded direction, when it is taken up.
6. **A small regression suite** from the existing determinism fingerprints
   and frozen-clock captures.

### Optional creative directions

- **Water that carries light:** soft reflective patterns and openness in
  the spirit of *Journey*, kept in lavender and pearl.
- **Revisit the haze palette** toward pearl and lilac rather than ice.
- **Camera paths or presets** that frame gatherings rather than the centre.

### Longer-term conceptual possibilities

- **Feedback:** colonies adding to the record, so placement in a second
  generation reads the first one's residue. This is the step from "a world
  that shows a history" to "a world that keeps making one". Demonstrated
  for one patch in study 10 (stages 0–2), under review.
- **Decay:** colonies that thin, collapse into residue and seed what follows.
- **A live history in Explore:** the record and the colonies developing over
  minutes rather than being recomputed.
- **The volume's spanning structures** as undersides or cavities of the
  shared ground.

### Ideas to keep exploratory

These should stay exploratory, not become requirements:
- **Species, agents and migration.** In the original direction, but none
  exists; colonies are not agents.
- ***Annihilation*,** as a conceptual inspiration rather than a visual
  target.
- **Branching,** as a close-range study, paused.
- **Further shader readings or new particle kinds.** These add layers rather
  than connections.

---

## Documentation map

| Document | What it is |
|---|---|
| [README](../README.md) | The public introduction |
| This report | Status, findings and directions, October 2026 |
| [architecture](architecture.md) | Views, state, the verified dependency diagram, known spatial issues, verification results |
| Studies [01](01-noise-study.md)–[09](09-composition-and-light.md) | Research records, kept as written |
| [references](references/README.md) | External references and AI-generated concept studies; neither is project output |
| [backlog](../backlog.md) | Open work, by kind |
| [PROJECT_DIRECTION](../PROJECT_DIRECTION.md) | The original concept; its ambition against what is implemented; the October visual direction |
| [AESTHETIC_LANGUAGE](../AESTHETIC_LANGUAGE.md) | Visual and experiential principles, reconciled in October |
