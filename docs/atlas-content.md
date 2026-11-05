# Atlas · content and asset map

*21 October 2026. A first pass (phase 1) of the Atlas section, built locally;
not committed or deployed.*

Atlas is an editorial archive of Residual Ecology, reached at `/atlas`. It
sits beside Explore and the Studies; it does not replace them. This document
records:
- what Atlas draws on;
- how each asset is classified;
- what is uncertain;
- what is still missing.

## Sources

**The texts:**
- [README](../README.md) and [project direction](../PROJECT_DIRECTION.md);
- the [aesthetic language](../AESTHETIC_LANGUAGE.md);
- the [project status report](project-status-2026-10.md);
- [architecture](architecture.md) and the [backlog](../backlog.md);
- studies [01](01-noise-study.md) to [09](09-composition-and-light.md);
- [study 10](10-lifecycle-concept.md), on the lifecycle and the shared
  tissue.

Atlas's copy paraphrases them closely. Its figures and dates are theirs.

**The user's design documents** ([01](01-PROJECT-HANDOFF.md),
[02](02-ECOLOGICAL-LOGIC.md), [03](03-DEMO-EXECUTION-PLAN.md)) were read
for their terms and boundaries, not quoted: residents, colonies, shared
tissue, and the emergent core, which is a proposal.

## What is built, and what is not

What Atlas may say is implemented, and how:

| | Where it runs | Atlas says |
|---|---|---|
| **Ground:** landform, relief, water veins | Explore, every view | implemented |
| **The record:** the sediment history, precomputed | Explore (History); live only in Field and Shaders | implemented. It does not develop while you watch |
| **Colonies:** three languages, gathering, held light | Explore | implemented. Placed once from the record; Growth replays when forms appear, never where |
| **The air:** dust, wisps, haze, fragments | Explore | implemented. The one system that changes continuously; it writes nothing back |
| **Branching tissue** | one colony | a checkpoint, close range only |
| **Residents' lifecycle:** release, residue, new growth | `?lifecycle=1`, one patch of one colony | a development demo, bounded |
| **Shared tissue between colonies** | `&conduit=1` | a development experiment, unfinished and paused |
| **Warm accent, uptake cues** | `&warm=…` | an A/B study |
| **The conduit's 3D form** (fold, greybox) | `&fold=1`, `&greybox=…` | display studies of one stretch, paused; not a final form |
| **Emergent core, feedback to residents, persistence across sessions** | — | **proposed only**, in the design documents and design boards |

## Asset classes

Every image in Atlas carries one of these labels:

| Label | What it is | Where it comes from |
|---|---|---|
| **App capture** | A capture of the running app, often a labelled comparison sheet | `docs/images/`, as the studies used them; captions follow the studies' own alt texts |
| **From simulation data** | A diagram drawn from the simulation's data, not a render | `10-stage2-record`, `10-tissue-map`, `10-fold-section`, `08r-map`, `09-map` |
| **AI-generated concept study** | An exploratory mockup made before building; not a screenshot | `docs/references/concept-studies/` (filed as such in the references README) |
| **AI-generated design study** | A board describing proposed behaviour, marked "Proposed behavior / Design study" | `docs/references/01-habitat`, `02`, `03`, `04-body1`, `05-body2`, `conduit-01` (identified by the handoff document) |
| **External reference** | Others' work, credited, for study only | Sabrina Ratté, *Plane of Incidence*; *Journey* (thatgamecompany); *ABZÛ* (Giant Squid); *The Ephemeral Lake* |
| **Drawn for the Atlas from project data** | The portal's four drawings of the first revision; no longer shown (see below) | `react-app/src/atlas/specimens/` |
| **Conceptual illustration** | The portal's five chapter images: supplied for the Atlas, not screenshots and not simulation evidence | Originals in `docs/references/atlas-layout/`, cropped web copies in `react-app/src/atlas/portal/` |

**Not used:**
- **`docs/references/atlas-layout/`:** the art-direction references for
  Atlas itself (AI-generated layouts). They guided typography and
  composition only.
- **`fragment-material-ref.jpeg`:** its source is not recorded.
- **The baseline air figures** (`07-air`, `07-ecology`, …): they show a
  superseded ecology (commit `cf0431d`).

## Chapters and their material

*As first built. The revision of 22 October changed the selection; see
[Editorial revision](#editorial-revision-22-october-2026).*

| Chapter | Built from | Main images |
|---|---|---|
| 01 World | README "The world"; studies 01, 02, 04, 06, 07, 09; status "What evolves over time" | `06-stream`, `05-history`, `06-flow`, `09-overview`, `07-p6-default` |
| 02 Life Cycles | studies 05 and 09 (colonies); study 10, stages 0–2 (residents) | `05-colony`, `05-languages`, `05-growth`, crops of `10-stage2-stills`, `10-stage2-record` |
| 03 Matter Exchange | study 10: stages 0–2, shared tissue, uptake, fold, greybox | crops of `10-tissue-close` and `10-tissue-map`, `10-uptake-close`, `10-greybox-views`; `conduit-01` and `02` as labelled design studies |
| 04 Field Notes | the README's studies table, each study's status | one image per study where one exists, `10-greybox-tried` |
| 05 Fragments | the references README; the handoff's list of design boards; status "Ideas to keep exploratory" | concept studies, design boards, external references, labelled |

## Uncertainties

- **External references and rights.** They are in the public repository
  already; Atlas shows them small, credited, for study. Whether they may be
  shown on a public site is to be checked before any deployment.
- **Dates.** Only the dates the documents give are shown. Studies 01–09 are
  dated by week or assignment in their own documents, not by day.
- **Missing screenshots.** Studies 01, 02 and 04 never had any captured (as
  their documents say). Atlas shows a placeholder instead of standing in
  another image.
- **Study 10's links.** Its document, and the user's three design
  documents, are not yet on GitHub, so Atlas names their local paths
  instead of linking them.

## What was built (phase 1)

**The pages:**

| Route | Page |
|---|---|
| `/atlas` | **Landing.** The default overview (a real capture) drifting slowly behind the title, with three chapters pinned to what they name in the image: the land, a colony, the residue bands. Enter the Atlas → Portal; Explore the World → Explore |
| `/atlas/portal` | **Portal.** Five fragments in an open field, each a crop of real material in a soft outline. They drift slightly with the pointer, at different depths, and are joined by faint dotted threads |
| `/atlas/<chapter>` | **A chapter:** `world`, `life-cycles`, `matter-exchange`, `field-notes`, `fragments`. A number, title and introduction beside one annotated image; then its blocks; then observations, open questions and sources; then previous, all chapters, next |

**Every image is labelled with its kind.** Every chapter cites its documents:
- published ones link to GitHub;
- the four local-only ones (study 10, the handoff, the ecological logic,
  this file) are named by their path.

**Ways in:**
- Explore's header reads Explore · Atlas · Studies;
- the title "Residual Ecology" opens the Atlas;
- in the Atlas, Studies returns to the app with the Studies menu open.

**Navigation:**
- Every route opens directly, and back and forward work.
- Unknown Atlas paths show a short "no such page".
- Where the browser supports view transitions, pages dissolve into each
  other and a portal fragment opens into its chapter's image.
- With reduced motion, nothing drifts or animates.

## In the code

| File | What |
|---|---|
| `src/Root.jsx`, `src/lib/route.js` | The one routing decision: `/atlas…` opens the Atlas, anything else the app. Both load lazily, so the Atlas never loads the 3D scene (its bundle is about 47 kB of script) |
| `src/main.jsx` | Renders `Root` instead of `App` |
| `src/App.jsx`, `App.css`, `components/ViewTabs.jsx` | The Atlas tab, the title as a link (it looks as before), and opening on the Studies menu when the Atlas asks |
| `vite.config.js` | Lets the dev server read `../docs`, where the images are; the build bundles them |
| `src/atlas/content.js` | All the chapters' words and structure, as data |
| `src/atlas/assets.js` | Every image: its kind, caption and source document, and crops of comparison sheets |
| `src/atlas/docs.js` | The cited documents, and whether each is published |
| `src/atlas/*.jsx`, `atlas.css` | Landing, Portal, Chapter, the shared parts, and their styles |

**Unchanged:** procedural generation, shaders, the lifecycle, the matter
accounting and the simulation.

## Checks, 21 October 2026

- **Explore unchanged.**
  - Frames with the flag off are pixel-identical to a clean build of
    `c923a84`: 12 frames, 5 worlds, the header hidden as before.
  - The lifecycle and conduit frames match their baselines.
  - Field, Volume, Shaders and Scatter open and render.
- **Navigation, in a headless browser:**
  - the title and the Atlas tab open `/atlas`;
  - landing → portal → chapter → next chapter;
  - back and forward;
  - Atlas → Studies (the menu opens);
  - an unknown path.
- **Images and links.**
  - No broken images on any of the seven pages (55 images, all loaded).
  - All 16 published documentation links return 200.
- **Reduced motion and phone width.**
  - With reduced motion forced, the landing's drift, the page entry and
    the portal's parallax are all off.
  - At 390 px nothing scrolls sideways, the chapter notes become a list,
    and the portal stacks.
- **Build and lint.** The build passes. Lint gives 0 errors and 58
  warnings, none in the Atlas or the routing.

## Gaps and placeholders

- **No screenshot exists for studies 01, 02 and 04.** Field Notes shows an
  outlined placeholder that says so.
- **No dedicated imagery of colony decay or an emergent core exists,**
  because neither is built. Atlas mentions them only as proposed, or shows
  the design boards labelled as such.
- **A few comparison sheets are cropped to one panel.** For example, the
  lifecycle frames from `10-stage2-stills` and the tissue crops; each crop
  keeps its sheet's own label.
- **The external references' rights** need checking before any public
  deployment.
- **The images are bundled from `docs/`** (35 files, about 40 MB in the
  build). They are the originals, not resized for the web.

## Possible speculative readings, and how they are guarded

- **The landing's line "a living archive of a world becoming"** is the
  brief's own copy. The chapters say plainly that Explore's ecology does
  not develop while it is watched.
- **The landing pins** sit on parts of a real capture. "Matter Exchange"
  is pinned to the air's residue bands, which do exist in Explore; the
  tissue does not appear there without its flag.
- **The Matter Exchange chapter** describes development experiments in the
  present tense. Its steps carry the note "all four run behind development
  flags", and the status list separates built, demo and proposed.

## Phase 2, for later (not built)

- **Richer fragment interactions** on the Portal: material shifting,
  details revealed on hover.
- **Chapter-specific motion:**
  - the lifecycle sequence playing as frames;
  - the tissue map's six moments as a scrub.
- **Stronger transitions** between landing, portal and chapters, beyond
  the shared-image morph.
- **Specimen and diagram explorations:** zoomable sheets, before/after
  sliders for the A/B captures.
- **Images resized and compressed** for the web, with responsive sources.

## Phase 3, possibilities only

- Live links from the Atlas into Explore at a given view or flag.
- Automatically updated captures from the frozen-clock harness.
- A dynamic archive of lifecycle events from the simulation's log.

## Editorial revision, 22 October 2026

The review found the first pass read like a documentation site filled with
screenshots. This pass is a curation, not a rebuild. The routes, chapters
and palette are unchanged.

### Navigation that keeps out of the way

`components/QuietNav.jsx` is used on every Atlas page and on Explore.

**Showing:**
- the title and its links show for a moment on arrival, then fade;
- a mouse near the top left brings them back;
- keyboard focus inside them shows them;
- a small mark stays in the corner. Tapping or clicking it keeps them open
  (the way in on touch screens), and Escape or a tap elsewhere closes them.

**Always shown:**
- in the studies, and while Explore's Studies menu is open, where the tabs
  are working tools;
- on chapter pages, the small "All chapters" link (on the portal, "← Atlas").

Explore's scene, panel and simulation are unchanged. Its header is the only
part of the app touched.

### The landing

Kept: the capture, the palette and the type. Removed: the three chapter
pins, the chapter index along the foot, and the technical caption. What is
left is the title, its introduction and the two ways in.

### The portal's specimens (22 October)

The five clipped screenshots are replaced by five specimens on an open
grid, so none can overlap.

**The four drawings.** Each is drawn for the Atlas from the project's own
data and labelled on the page as a drawing. The generator scripts ran
outside the repository, on the scratch harness that loads the app's own
`lib/` modules. The SVGs are kept in `react-app/src/atlas/specimens/`.

| Chapter | Specimen | Derived from |
|---|---|---|
| World | A contour model of the default world's south island (colonies 0–2), heights exaggerated, seen from the direction of Explore's default camera | `world.groundY` on a 260² grid (seed 42, the defaults) |
| Life Cycles | Resident #1's membrane, standing, with the outline it lies down to dashed on the ground | The columns the bloom builder (`buildBlooms`) makes for that resident; the outline is the form shader's recline transform at 1 |
| Matter Exchange | The shared tissue at 400 s, its width by use, champagne only at the nodes holding the most matter, on a faint outline of the island | The simulation's own nodes, paths, conductance and held matter (`&conduit=1`, default world) |
| Field Notes | A section through the island, through colonies 2 and 1: landform, the record laid on it, the water level, membranes at their true height (ground heights ×3) | The landform sampler, the displayed sediment lift, and placed membrane heights |

**The fifth, Fragments**, is three real archive items, each shown whole as
a small plate: a concept study, an external reference and a design board.

### Chapters, reduced

| Chapter | Before | After |
|---|---|---|
| World | 3,869 px | 2,437 px |
| Life Cycles | 5,035 px | 2,768 px |
| Matter Exchange | 5,974 px | 3,463 px |
| Field Notes | 4,507 px | 3,047 px |
| Fragments | 5,026 px | 4,279 px |

**The pattern:**
- one annotated image;
- one mechanism, drawn on the page rather than shown as a screenshot: the
  dependency chain, a resident's stages as a timeline, the exchange as a
  loop, how a study is checked;
- two or three chosen images;
- two observations and two open questions;
- further reading;
- an archive, closed until asked for.

**Images:**
- **Cropped clean.** Panels of labelled sheets are cropped below their
  burned-in labels.
- **No development UI on the page.** The Explore capture with its panel,
  and every multi-panel montage, moved to the archives.

**What stays prominent, moves to the archive, or is left out:**

| Prominent | Moved to a chapter's archive | Left out of the public Atlas |
|---|---|---|
| `06-stream`, `05-colony`, `10-tissue-close` (panel), `08r-close`, three frames of `10-stage2-stills`, two panels of `10-stage2-app`, panels of `10-tissue-map`, `09-overview` (after), `07-p6-default` | `05-history`, `06-flow`, `09-overview` (both), `05-languages`, `05-growth`, `05-colony-detail`, `10-stage2-record`, `10-tissue-map` (all six), the arrival at 276 s, `10-greybox-views`, `10-greybox-tried`, `explore-2026-10`; in Fragments, all eleven other concept studies, design boards and references | `10-uptake-close`, `10-warm-*`, the fold study's other figures, `08r-map`, the superseded air baseline, `fragment-material-ref` (no source) |

### Research and speculation, apart

- **Field Notes** is the research: a close observation (study 08), how a
  study is checked (fingerprints, frozen-clock captures, review), and the
  ten studies with one clean thumbnail each.
- **Fragments** has three separate sections, each with its own label and
  note:

  | Section | What it holds |
  |---|---|
  | **Influences** | external works |
  | **Proposals** | two AI-generated images: one concept study and one design board, never beside app captures |
  | **Set aside** | the project's own rejected first branching pass and the superseded fold study |

  There are no hand sketches in the repository; the page says so. The
  other proposals and references are in its archive.
- **Matter Exchange** no longer shows design boards. It points to what is
  proposed through its status list.

### Assets worth making separately

- **Screenshots for studies 01, 02 and 04.** Their documents already say
  what to capture.
- **A clean, label-free capture of the shared tissue** at a colony at the
  default view: the chapter uses panels of comparison sheets.
- **A frame sequence or short loop of one resident's cycle,** captured
  without labels, to replace the three cropped stills.
- **The specimen generators as a script in the repository,** so the four
  drawings can be regenerated when the world or the tissue changes.
- **Web-sized images.** The Atlas still bundles the originals (about
  40 MB).

### Checks, 22 October 2026

- **The portal at 1280×800, 1440×900, 1600×1000 and 1920×1080:** no
  entries overlap, and all five sit within the viewport.
- **At 390 px:** nothing scrolls sideways on any page.
- **Quiet navigation:** checked in a headless browser:
  - arrival, then fade;
  - shown near the corner;
  - the mark opens it and keeps it open;
  - Escape and a tap elsewhere close it;
  - always shown in a study.

  Keyboard focus shows it through `:focus-within`. The headless window
  never has system focus, so the script's focus events cannot be tested
  there.
- **No broken images** on any page, with the archives opened.
- **Explore unchanged.** Flag-off frames are pixel-identical to a clean
  build of `c923a84` (12 frames), and the lifecycle and conduit frames
  match their baselines.
- **Build and lint.** The build passes. Lint gives 0 errors, and no new
  warnings.

## Portal illustrations, 22 October 2026

The portal's specimens felt too technical and schematic, so they were
replaced with five supplied illustrations, one per chapter, shown as
supplied:

| Chapter | Original (`docs/references/atlas-layout/`) |
|---|---|
| World | `ethereal_translucent_topographic_island.png` |
| Life Cycles | `ethereal_lavender_glass_sail_sculpture.png` |
| Matter Exchange | `bioluminescent_matter_exchange_conduit.png` |
| Field Notes | `lavender_field_notes_specimen_collage.png` |
| Fragments | `ethereal_lavender_specimen_collage.png` |

**What they are.** Conceptual chapter illustrations: not screenshots of the
app, and not evidence from its simulation. The portal says so under its
introduction, and each image's alternative text begins "Conceptual
illustration for …". How they were made is not recorded here.

**The copies.**
- The originals are unchanged.
- The portal uses copies in `react-app/src/atlas/portal/`, cropped to each
  image's visible content (transparency above 3 of 255, plus a 10 px
  margin), at most 960 px on the long side, WebP: about 700 KB in all,
  against 5.2 MB.

**The composition.**
- Three above, two below, on the portal's 12-column grid.
- Each image keeps its own proportions; only its width is set.
- Life Cycles sits centred in four columns, so the gaps either side of it
  match.
- The lower two have their labels beside them.

**Movement.**
- A very slow float, and the pointer drift.
- On hover or focus: a small lift and scale, a little more colour, and the
  title turns violet with a small arrow.
- The whole item, transparent areas included, opens the chapter.
- With reduced motion, none of it moves.

**Unchanged:**
- the landing;
- the chapter pages: pixel-identical to the previous round;
- the routes;
- the quiet navigation;
- Explore and the Studies.

**No longer used.** The four SVG drawings in `react-app/src/atlas/specimens/`
are no longer imported or bundled. They were left in place, not deleted.

**Checks:**
- **Desktop fit:** at 1280×800, 1440×900, 1600×1000 and 1920×1080, all
  five images and labels sit within the viewport, with no overlaps.
- **Smaller screens:** at 820 and 390 px wide they stack, with nothing
  scrolling sideways.
- **Links:** all five open their chapters.
- **Explore:** frames with the flag off are pixel-identical to a clean
  build of `c923a84`.
- **Build and lint:** the build passes; lint gives 0 errors and no new
  warnings.

## Portal checkpoint, 24 October 2026 (paused)

The portal as it stands is kept as a working checkpoint. Design work is
paused.

**What it has:**
- **Layout:** the five illustrations composed on one stage, with Life
  Cycles at the centre.
- **Atmosphere:**
  - a lavender-to-pearl ground with slow mist;
  - a faint reflective plane that the nearer specimens rest on;
  - **residue carried by moving air** (`PortalAir.jsx`), a small 2D echo of
    the World's wisps (study 07, phase 2.5) on its own canvas, importing
    none of the World's code.
- **Text:** at rest, numbers and names only; the one line appears on hover
  or focus.

It was refined in the release worktree (`pwb_hw0-atlas-release`, on
`53bb1c5`) and copied into this workspace on 24 October, where it is
committed locally (not pushed or deployed):
- `Portal.jsx`, `portal.css` and `PortalAir.jsx`;
- `atlas.css`, with its old portal rules removed.

**Deferred: polish for later, not problems to fix now**
- The atmosphere still feels slightly sparse in places.
- The residue in the air is subtle; it is hard to notice without watching
  it move.
- At close inspection, some traces look slightly brushed.
- Activity is intermittent, so some moments are nearly still.
- Field Notes and Fragments are quieter and smaller than the other three.
- The portal could tie more closely to the World, without scenery or heavy
  rendering.
- On phones the atmospheric layer (plane, reflections, residue) is left
  out.

## Fragments revision, 27 October 2026

The Fragments chapter now makes the research legible in three sections,
before its proposals, set-aside passes and possibilities (kept as they
were):
- **Artistic and experiential precedents:** five external works, each with
  what was observed in it and what it was translated into.
  - Ratté, Steensen, *Journey* and *ABZÛ* use the images already in
    `docs/references/`.
  - *Hylozoic Ground* has no image in the project, and says so in its place.
- **Biological and systems research:** mycelial networks and *Turritopsis
  dohrnii*, as in [study 10](10-lifecycle-concept.md#biological-references-mechanisms-not-visual-instructions),
  each with what was borrowed and what is not claimed, and the study's five
  sources.
- **From reference to design:** reference → observed principle → design
  translation → status (implemented, bounded demo, paused, experimental,
  proposed), each row citing its study.

**Credits corrected and verified:**
- *The Ephemeral Lake* is by Jakob Kudsk Steensen (2024; it was "artist not
  recorded").
- Years were added for Ratté (2024), *Journey* (2012) and *ABZÛ* (2016).
- *Hylozoic Ground*: Philip Beesley, Canada Pavilion, Venice Architecture
  Biennale 2010.

The archive no longer repeats references now shown in the chapter.
`docs/references/README.md` records the same.
