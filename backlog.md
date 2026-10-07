## Initial Backlog - v0

- [ ] Explore possible procedural inputs
- [ ] Test basic 3D environment generation
- [ ] Experiment with terrain / spatial generation
- [ ] Explore atmosphere, particles, or environmental movement
- [ ] Test how input data could change the environment
- [ ] Narrow the project direction based on course experiments

## Paused — revisit later

**Study 06 · Water veins (spline).** Still unresolved after study 07. Paused after the scale pass; the
Assignment 2 relationship (terrain → spline → mesh, in the shared world)
works. Known limitations, details in
[`docs/06-passages-study.md`](docs/06-passages-study.md#known-limitations--future-revision):

- [ ] Water surface motion follows the stream: drive ripples along the local
      spline tangent / flow direction, or replace the regular bands with
      subtler irregular variation (currently reads as horizontal scan lines)
- [ ] Source placement from stronger world logic: thickness / topography,
      local catchment, accumulated trace / history, relationship to colonies
- [ ] Integration as a landform: the stream still reads as a layer placed on
      the terrain

## Done

- [x] Particle study, first pass: scene-wide ambient air
      ([`docs/07-air-study.md`](docs/07-air-study.md))
- [x] Particle study, second pass: from a uniform ambient field to a resident
      ecology (dust, wisps, motes, flakes, haze; quiet pockets, downhill
      streams, colony circulation)

## Next

- [ ] Air: flakes turned by the air around them rather than a scripted spin
- [ ] Air: veils occluded by colonies, not only the floor

