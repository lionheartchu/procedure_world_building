# Residual Ecology — Project Direction

*The sections up to "Current Direction" are the original September framing,
kept as written. The October sections say how far the implementation had
come, and how the visual direction moved; the November section at the end is
the current one.*

## One-line concept

**A dreamlike living ecology where terrain, organisms, and collective behaviors continuously leave traces that reshape the world for what comes next.**

## Core Idea

The **world produces its own traces** through erosion, growth, migration, accumulation, decay, and repeated behavior. These traces do not only visualize the past — they gradually change the conditions of the environment.

The world can also be understood conceptually as **one large living organism**. Its terrain, cavities, flows, vegetation, and species behave like interconnected tissues or systems. This acts as a framework for making different procedural systems feel related.

## Dreamcore Vibes

Soft fog, slow movement, ambiguous scale, pale organic forms, deep shadows, and restrained luminous traces make processes feel partially hidden. Aim to let player perceives the effects of activity before fully seeing its cause.

The intended feeling is:

**dreamy, quiet, organic, slightly creepy, and alive without being busy.**

## Procedural Direction

The final world may combine several systems explored throughout the course:

**terrain / sediment → flows → growth → species → behavior → residue → changed environment**

Possible relationships include:

- terrain and voxel structures forming basins, layers, cavities, and porous regions
- water / wind / vector fields influencing movement and distribution
- procedural vegetation responding to environmental conditions
- species with generated forms or behaviors
- agents migrating, gathering, resting, or returning
- repeated activity leaving paths, deposits, fragments, or growth
- environmental traces influencing future ecology

The goal is to build a few systems that meaningfully affect one another.

## Elements to Carry Forward

The project retain the visual and conceptual grammar:

- **Accumulation** — material, organisms, or activity gradually gather
- **Return** — tides, migration, or repeated behavior reinforce locations
- **Fragmentation** — erosion, decay, or rupture breaks structures apart
- **Growth** — living systems extend and occupy favorable conditions

Visual language can continue to use:

- indigo / lavender atmospheric environments
- pale membrane-like and sedimentary forms
- fog, reflective surfaces, and soft depth
- slow movement
- sparse luminous mint for active living processes
- traces and residues as evidence of events

## Current Direction

For now, I want to explore a **small but coherent ecology rather than an entire planet**: a basin, estuary, valley, or similar environment that can evolve over time.

The central question is:

> **How can a procedural world reveal its own history through the traces its systems leave behind?**

The exact species, geography, and narrative will emerge through the remaining weekly experiments.

## Ambition and current implementation — October 2026

The ideas above are the project's ambition: a world whose traces keep
changing the conditions for what comes next. The implementation realises
part of it.

**Implemented:**
- **One chain of real dependencies.** The landform shapes the streams. The
  streams are carved into it. A sediment record is laid down on that ground.
  Colonies form where the record allows. Their matter shapes light, a
  tissue network and the local air.
- **Accumulation, as visible residue.** Sediment, colony size, residue and
  light all show it.

**Not yet:**
- **The world does not continuously write back into its history.** The
  record is computed in advance from the parameters, and the colonies are
  placed on it once. Neither develops while the world is watched; only the
  air moves continuously.
- **Life does not add to the record,** so one generation does not shape the
  next.
- **Return and fragmentation are motifs, not processes.** They appear as a
  tide, as residue and floating fragments, and as the volume study's
  ruptures.
- **Migration and agents** are not implemented. They remain directions.

The detail is in the
[project status report](docs/project-status-2026-10.md#what-evolves-over-time-and-what-is-computed).

## Visual direction — October 2026

*Added after the October reviews. The sections above are the September
framing and are kept as written; where they differ, this note is the more
recent, but the direction is still exploratory.*

**Confirmed:**
- **Dreamy, hazy, softly luminous,** with breathing room.
- **Violet, lavender, lilac and pearl,** with subtle iridescence.
- **Translucent, ambiguous, half-formed materials.**
- **One interconnected landscape,** not an assembly of separate objects.
- **Residual matter** that accumulates, changes and becomes part of a
  larger ecology.
- **Muddiness is not fixed by going darker or bluer.** A pass toward
  ultramarine and icy blue was rejected.

**References, each for one thing** (files in
[`docs/references/`](docs/references/)):
- **Sabrina Ratté's *Plane of Incidence*:** materiality and continuity.
- ***The Ephemeral Lake*:** time, impermanence, a form and its environment.
- ***Journey* and *ABZÛ*:** atmosphere. From *Journey*, the luminous water
  and air (soft light, delicate reflective patterns, openness, immersion),
  but not its cyan-blue palette.
- ***Annihilation*:** a conceptual inspiration only. No image is kept in the
  reference folder, by intent.

None of them is a specification.

**Historical, no longer binding:**
- **The mood:** "deep shadows" and "slightly creepy" above.

**Mint** remains a rare, optional accent for something active, never a
general colour.

**The world's edge.** Move away from a square slab toward an organically
gathered landform whose edges pass into the surrounding atmosphere. This is
a direction, not a design; no geometry is prescribed.

The working principles are in
[`AESTHETIC_LANGUAGE.md`](AESTHETIC_LANGUAGE.md).

The current state of the project, and what is still open, is in
[`docs/project-status-2026-10.md`](docs/project-status-2026-10.md).

## November 2026: what disappears still participates

*Added at the M3E checkpoint (`0423401`, 10 November). The sections above
are kept as written; where they differ, this one is current.*

**The concept: Residual Ecology. What disappears still participates.**
After a resident is gone, its matter, the signals it gave off, and the
traces it left can still shape the conditions for other lives.

The world should feel like one interconnected, continually changing
ecology with a shared history. It should keep its dreamy, sparse, ambiguous
and slightly uncanny character.

**Two directions, one project:**
- **Explore** (`/`): the procedural studies, parameter exploration,
  simulation inspection and the research Atlas (`/atlas`).
- **Habitat** (`/habitat/…`): an embodied world to be in, built from those
  systems.

**What the words mean, as implemented** (each checked against the code):
- **A resident** is one membrane lifeform with a lifecycle (forming,
  holding, receding, releasing, ended) and a body of matter.
- **A colony** is a local neighbourhood. Its placed structures (membranes,
  strands, branching, tissue) are laid out once, and one lifecycle patch
  runs its residents.
- **Released films** carry part of a resident's body on the air and settle
  as residue. New residents form only from residue that has lain a while.
  Matter is conserved and only moves (`ledger()`, study 10).
- **The airborne cue** is a signal and carries no matter. Residents
  downwind answer it by their own state: a full one lets go early; one still
  forming turns toward it, and later releases from the turned sheet (studies
  19–20).
- **Records.** Some recorded fields are read by the ecology: the residue
  itself, when matter last arrived (the 22 s rest), and History's sediment
  record for where a resident may form. Others are drawn only, such as the
  cue's passage. **A recorded field is not automatically feedback.**
- **The visitor's encounter** deforms a resident and is felt in movement. It
  reads the resident's state and writes nothing to the ecological ledger
  (study 22).

**Not yet:**
- **History's record and the colonies' placement** are still computed once.
- **Nothing accumulates into larger forms.**
- **Collective morphogenesis, a persistent accumulator and evolutionary
  inheritance** are directions, not systems.

**Next: distributed perception → behavioural response → accumulated
morphology.**

What each resident can perceive locally (air, water, terrain, light, its
neighbours), how it answers by its own state, and how many such local
answers and their residues might add up over time to shared spatial forms.
Behaviour may take inspiration from mycelium: local sensing, distributed
growth, branching, redistribution, reinforcement and dormancy; never its
look. Genotype, phenotype and fitness are a lens for reviewing the system;
optimisation and inheritance are later possibilities.

An ambient illumination cycle may become an input, without a literal sun.
No resident form or final structure is prescribed. The visitor stays a
limited, local influence, and a signal stays distinct from matter.

The questions and candidate first steps are in the
[backlog](backlog.md#next-residual-morphogenesis-after-the-m3e-checkpoint).
The presentation notes are in
[`docs/presentation/`](docs/presentation/README.md).

