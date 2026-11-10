# Residual Ecology: presentation notes (November 2026)

*Preparation for the class presentation. A guide to the work as it
stands, not a slide deck.*

| | |
|---|---|
| **Checkpoint** | Habitat M3E, commit `0423401` on `local-experiments` (pushed) |
| **Live the ecology** | `/habitat/m3e` (locally `http://localhost:5173/habitat/m3e`) |
| **Explore and the Atlas** | `/`, `/atlas` |
| **The studies behind it** | [README](../../README.md#studies): studies 01–22 |

Every claim below carries one of four labels:

- **[Implemented]:** built, and checked the way the studies describe.
- **[Experimental]:** built, but a prototype under review.
- **[Visual only]:** a drawing of real state, with no effect on it.
- **[Concept]:** a direction, not built.

---

## 1. Introduction (1–2 minutes, spoken)

> Residual Ecology asks what a procedural world would be like if what
> disappears kept taking part. It began as a set of procedural studies in
> Explore: a landform, a sediment simulation that leaves a record on it,
> streams, membranes, branching structures and air. The question was how
> those systems could depend on one another, not sit side by side.
>
> Over the semester the membranes became residents. Each one lives a
> lifecycle: it rises by taking up matter from the ground, stands, lies
> down, and lets go of films that carry its matter on the air. Where they
> settle, the matter becomes residue that a later resident can grow from.
> What is left of it stays on the ground as a contour, a trace that slowly
> gives itself away.
>
> Then the lifecycles began to share something: a release breathes a signal
> into the air, and residents downwind answer it by their own state. That
> is a cue, not matter.
>
> Finally the world became a habitat. It is wide and sparse, with thirteen
> colonies living out of step, and you can walk through it in first person.
> In the newest version a resident yields to you as its own state allows. It
> only reads that state, and it never changes its ledger.
>
> What does not exist yet, and is where we are going: residues and signals
> that accumulate into larger shared forms over time.

**One line:** *What disappears still participates.*

---

## 2. Suggested slides (6–7)

Image paths are relative to `docs/`.

| # | Slide | Message | Images (paths below) |
|---|---|---|---|
| 1 | **Residual Ecology** | One world, one question: what disappears still participates | `presentation/media/m3e-arrival-t1000.jpg` |
| 2 | **Procedural foundations** (Explore) | A landform, a sediment record laid on it, water veins carved in, colonies placed by rules on that record, air, branching. Systems that depend on one another | `images/explore-2026-10.png`, `images/06-stream.png`, `images/05-colony.png`, `images/07-p5-colony.png`, `images/08-overview.png` |
| 3 | **From objects to ecology** | A resident's lifecycle and where its matter goes: up from the ground, out on the air, back down as residue, up again in someone else | `presentation/media/m3e-lifecycle-sheet.jpg` (or the time-lapse GIF), `images/10-stage2-on-off.gif` |
| 4 | **From isolated lifecycles to shared behaviour** | A release breathes a cue downwind; neighbours answer by their own state: let go early, or turn | `images/19-map.jpg`, `images/19-turn.jpg`, `images/20-motion.gif` |
| 5 | **From visualisation to habitat** | A distributed world to be in; close range made coherent (M3R); one encounter (M3E) | `presentation/media/m3e-overview-t1000.jpg`, `images/21-m3r-lying.jpg`, `presentation/media/m3e-encounter-realtime.gif` |
| 6 | **What works, what is hard to see** | The causal chain is real and deterministic. The cue and the age of things are hard to perceive | `images/21-m3r-forming.jpg`, `images/20-field-vs-record.jpg` |
| 7 | **Next: residual morphogenesis** | Distributed perception → behavioural response → accumulated morphology | `references/collective-morphogenesis/04_interaction_propagation.png` (a reference diagram, **not** an implementation) |

---

## 3. Images: what each shows

Paths are relative to `docs/`. The new captures in `presentation/media/`
come from the running app at commit `0423401`, in 2268 × 1200 windows
(downscaled for the files).

| File | Shows | Variant and conditions | Status |
|---|---|---|---|
| `presentation/media/m3e-arrival-t1000.jpg` | Arrival in the habitat | M3E, lifecycle time t = 1000 s, eye 0.5 above the ground | [Implemented] |
| `presentation/media/m3e-overview-t1000.jpg` | The distributed world from the visitor's highest eye (3.2) | M3E, t = 1000 s | [Implemented] |
| `presentation/media/m3e-lifecycle-timelapse.gif` | One resident, holding → receding → releasing → ended, 12 frames (each labelled) | M3E, colony 5 #3, t = 1010–1078 s, **time-lapse** | [Implemented] |
| `presentation/media/m3e-lifecycle-sheet.jpg` | Six of those frames, for a slide | As above | [Implemented] |
| `presentation/media/m3e-encounter-realtime.gif` | The visitor walks into a slack resident; it dents, leans, returns slowly | M3E, colony 2 #4 (45% full), observer camera beside it, 16 frames 250 ms apart: **close to real time** | [Experimental] |
| `images/explore-2026-10.png` | Explore, the procedural workspace | Explore, October | [Implemented] |
| `images/06-stream.png` | Water veins carved into the landform | Study 06 | [Implemented], paused |
| `images/05-colony.png` | A colony placed by rules on the record | Study 05 | [Implemented] |
| `images/07-p5-colony.png` | The air ecology near a colony | Study 07 | [Implemented] |
| `images/08-overview.png` | Branching tissue (L-system) | Study 08, one colony | [Implemented], a checkpoint |
| `images/10-stage2-on-off.gif` | The concept in one recording: feedback on (left), a resident's residue appears and a new resident rises on it; off (right), neither does | Study 10, Explore (`?lifecycle=1`), 20–120 s, side by side | [Implemented] |
| `images/10-tissue-flow.gif` | The mycelium-inspired shared tissue | Study 10, dev flag only | [Experimental], **paused**; not in the Habitat |
| `images/17-d-overview.jpg` | Habitat D: the distributed world | Study 17 | [Implemented] |
| `images/18-event-d1.jpg` | One legible passage (a film leaving its resident) | Study 18, D1 | [Implemented] |
| `images/19-map.jpg` | Where the cue passed, releases, and the answers they set off (a diagnostic map) | Study 19, M1 | [Experimental]; the map itself is a diagnostic |
| `images/19-turn.jpg` | A resident turned toward a neighbour's release | Study 19 | [Experimental] |
| `images/20-motion.gif` | The cue drawn in the moving air | Study 20, M2 | [Visual only] drawing of a simulated signal |
| `images/20-field-vs-record.jpg` | The cue at +45 s, and its record summed to +45 s and to +6 min ("fans") | Study 20 | The record is [Visual only]: nothing reads it |
| `images/21-m3r-lying.jpg` | M3 vs M3R: lying down as a bend, not a shear | Study 21, same resident and times | [Implemented] (posture is drawing) |
| `images/21-m3r-shore.jpg` | M3 vs M3R: the shoreline | Study 21 | [Implemented] |
| `images/22-encounter.jpg` | Taut vs slack resident, at rest and pressed | Study 22 | [Experimental] |
| `images/22-films.jpg` | Released films: soap bubbles (M3R) vs pieces of sheet (M3E) | Study 22 | [Implemented] (drawing) |
| `references/collective-morphogenesis/*.png` | Reference diagrams for relationships and change over time | Not from the app | [Concept], references only |

---

## 4. The resident lifecycle and where its matter goes

Verified in `react-app/src/lib/lifecycle.js`. One lifecycle runs per
colony: thirteen in the Habitat's M spaces, each on its own clock.
Deterministic: a fixed 0.1 s step and seeded randomness.

```
           residue on the ground (a 128² grid, settled by the sediment rule)
                 │  a resident forms only where:
                 │    · at least 0.1 of matter lies in its footprint
                 │    · nothing new has arrived there for 22 s
                 │    · the ground fits (History's record + the residue)
                 │    · there is room
                 ▼
   FORMING (26 s) ── takes matter up (0.03/s), unfolds as far as it has
                 │    matter; the ground it took from is thinner
                 ▼
   HOLDING (80–140 s, its own) ── may take up more
                 ▼
   RECEDING (20 s) ── lies down toward its lean
                 ▼
   RELEASING (28 s) ── 4 films leave, carrying 60% of its body
                 │         │
                 │         └─► carried by the air ─► settle ─► residue ─┐
                 ▼                                                      │
   ENDED: a contour lying on the ground, holding the rest; it gives part │
          of itself to a resident forming on it (keeping at least half)  │
                 ▲                                                      │
                 └──────────── a later resident forms here ◄────────────┘
```

**[Implemented]**
- **Matter is conserved.** It is held in five places (bodies, films in
  flight, the residue, contours, and what left the field) and only moves
  between them (`ledger()`).
- **The deposit shapes later growth.** With feedback off, the films still
  fly and settle, but nothing is recorded and nothing forms from them.
  Study 10 shows that growth differs for a reason you can trace to the
  deposit.

**What is not live:**
- **History's sediment record** and **where colonies sit** are computed once,
  before arrival. New residents read History's record but never write to
  it.
- **The shared tissue** (study 10, mycelium-inspired) is [Experimental],
  paused, and not in the Habitat.

**[Visual only]**
- **The posture:** the bend, lying down, the bead dissolving.
- **The residue drawn by its age.** It reads the real arrival times, which
  the simulation also uses for its 22 s rest rule.
- **The warm champagne accent** where matter crosses.

---

## 5. Two different influences

### The airborne cue: a signal, not matter

Verified in `lib/morph.js` and `lib/lifecycle.js`. **[Experimental]**
(M1–M3E).

**How it works:**
- **Emitted:** when a film comes away, a puff of cue is breathed into the
  air at that place, as strong as the matter the film carried.
- **Carried:** the air carries it downwind on one world clock, spreading
  and fading (a 70 s fade, a 220 s life).
- **Gathered:** every standing resident gathers what reaches it as a dose,
  which it forgets over 25 s.

**How residents answer, by their own state:**
- **Full, and standing at least 20 s:** past a threshold it lets go,
  beginning to lie down now rather than at the end of its own hold.
- **Still taking matter up:** it turns toward the release, with a 150 s
  memory. Its own films later leave from the turned sheet, so where its
  matter goes follows the signal.
- **Lying down or ended:** reached, unchanged.

**It carries no matter;** the ledger is untouched.

**Measured (study 19):**
- 16 residents let go early: 14 before arrival and 2 after.
- 8 of 13 standing residents were turned by more than 10% of their height,
  one minute in.

**[Visual only]**
- **The cue's colour in the air's wisps** (M2 onward): lilac as it leaves,
  then ice, then silver.
- **A resident's cool stain** from the cue it has gathered.
- **Its "passage" record:** where the cue has been is recorded, but nothing
  reads it. A recorded field is not yet feedback.

**Hard to see:** beyond about 10 units the cue is too faint to read.

### The visitor's encounter: physical, not ecological

Verified in `lib/encounter.js`. **[Experimental]** (M3E only).

**What it is:** the nearest standing resident becomes a surface that yields
to the visitor, one resident at a time.

**How it yields is set by the resident's state:** the matter its body holds,
and its stage.
- **A slack resident** dents deep (about 40% of its height), leans with the
  press, and comes back slowly.
- **A taut one** gives about 0.13, returns in about 0.2 s, and springs once
  past rest.

**The visitor's part:** where they touch, which side they come from, and
how fast they press. A slanting walk drags the dent sideways.

**The deformation and the collision are the same numbers:** what you see is
what stops you.

**It reads the lifecycle and writes nothing back.** The whole simulation
state at t = 1060 is identical with and without pressing residents (study
22).

---

## 6. What works, what is hard to perceive, what next

**Works:**
- **One deterministic causal chain** from landform to record to colonies to
  residents, conserved through release, deposit and regrowth.
- **The world lives without the visitor:** thirteen colonies out of step,
  each with its own history.
- **Close range is coherent** (M3R): shorelines, water, and a posture that
  bends rather than shears.
- **A small, honest encounter** (M3E).
- **Everything earlier remains** reachable at its own route.

**Hard to perceive:**
- **The cue at a distance.**
- **Age and history:** residue age reads only close up.
- **Matter in transit:** the M3E films are now small and quiet.
- **Taut residents' response** is subtle, by design.
- **Time:** the important events of a lifecycle are minutes apart.

**Next: residual morphogenesis.** [Concept] (see
[`PROJECT_DIRECTION.md`](../../PROJECT_DIRECTION.md#november-2026-what-disappears-still-participates)):
- **Distributed perception:** what each resident can sense where it stands.
- **Behavioural response:** how it answers, by its own state.
- **Accumulated morphology:** how local traces add up to shared forms over
  time.

**Not built, and not to be presented as built:**
- Collective morphogenesis
- A persistent accumulator
- Evolutionary inheritance

---

## 7. Demonstrations that work reliably

**Setup:**
- Run `npm run dev` in `react-app/`, then open
  `http://localhost:5173/habitat/m3e`.
- The world takes about **10–15 s** to appear: its history before arrival is
  computed first.
- Before presenting, open the page once and let it settle.

**Times:** the lifecycle clock starts at about **t = 905 s** when the world
appears and then runs in real time. "+2 min" means about two minutes after
the world appears.

| Demonstration | How | When |
|---|---|---|
| Walking through a living world | W A S D or the arrows to drift, drag to look, Q / E to lower or rise | Any time |
| **A lifecycle passing** | From the arrival, drift **straight ahead about 9 units** to colony 5 (the cluster ahead, behind the large sheet with a dark strand). Its resident #3 lies down from about **+1 min 50 s**, releases films from about **+2 min 15 s**, and ends at about **+2 min 45 s**. Its films show as small pale pieces with grains | From about +1:50; the timing is deterministic |
| **A cue setting off a neighbour** (study 19) | From the arrival, **turn round** and go to colony 8, about 6 units behind. Within about the first minute a release reaches a neighbour, which lets go about 70 s early | Within about the first minute; **hard to see the cue itself**: show the neighbour lying down |
| **The encounter** | Walk straight into a standing sheet at normal speed (W) and hold it; let go and watch it return. Any standing resident works. A **slack** one (forming, or one that took up little matter) gives deeply; a **full, standing** one gives little and springs back | Any time; residents lying on the ground are not met |
| Shoreline and water at eye height | Drift to a shore; look down into the shallows (Q to lower) | Any time |
| Comparison | `/habitat/m3r` (no encounter), `/habitat/m3`, `/habitat/m2` (= `/habitat`, the featured one), `/habitat/d1` | Each takes about 10–15 s to open |
| Explore and the Atlas | `/`: Explore, its studies and panels. `/atlas`: the archive | Any time |

**Avoid:**
- Approaching residents from behind: other colony forms usually block the
  way.
- Waiting for the cue to show from far away.

---

## 8. Known limitations at this checkpoint

From studies 21 and 22:
- **One resident is met at a time.** Others nearby can still be walked
  through.
- **Walking along a curving sheet at a slant** still crawls.
- **Looking straight down into deep water** is still fairly uniform.
- **A standing resident is a flat sail:** the builder's rest shape.
- **The cue and residue age** read only up close.
- **The capture harness** varies by a sub-pixel eye drift between sessions.
- **Not tested:** touch screens, other displays.
- **Lint:** 73 warnings, no errors. Most are React immutability notes on
  the frame loop's uniform writes.

**The smallest sensible next experiment** (after the presentation): a
**perception readout**.
- **What:** give each resident a small set of local readings that already
  exist in the world (the air at its crest, the water or damp ground near
  it, the light held in the ground, how many neighbours stand near it, the
  cue it has gathered).
- **How:** show them in the development inspector. Change no behaviour yet.
- **Why:** it says what a resident *could* respond to before any response
  is designed, and which readings vary enough across the world to matter.
