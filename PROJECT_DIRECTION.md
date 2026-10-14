# Residual Ecology — Project Direction

*The sections up to "Current Direction" are the original September framing,
kept as written. The October sections at the end say how far the
implementation has come, and how the visual direction has moved.*

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
