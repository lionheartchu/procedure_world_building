import { arriveAt, buildCanopy, buildVessels, choosePatches, chooseEncounterBy, findThresholds, placeCanopy, placeVessels } from './habitatSpaces'
import { FormWriter } from './traceForms'
import { chooseEncounter } from './habitat'
import { supportAt } from './presence'
import { composeDistributed } from './habitatWorld'

/**
 * What a Habitat space places on its world, by its rule: the scatter it
 * uses (with any threshold veils added), its vessels, its lifecycle
 * patches, its encounter membrane and where the visitor arrives.
 */
export function composeSpace(space, { world, scatter }) {
  if (!space.organise) {
    // v0, as it was: pinned colonies and a pinned arrival.
    const [x, , z] = space.arrival.p
    return {
      scatter,
      vessels: null,
      patches: space.patches,
      encounter: chooseEncounter(scatter, space.encounter.colony),
      arrival: { p: [x, supportAt(world, x, z) + 0.5, z], look: space.arrival.look },
    }
  }
  if (space.organise === 'distributed') return composeDistributed(space, { world, scatter })
  const seed = space.scatter.seed
  if (space.organise === 'thresholds') {
    const { necks, veils } = findThresholds(world, scatter, { seed })
    const bloom = scatter.layers.bloom
    const placed = { ...scatter, layers: { ...scatter.layers, bloom: { ...bloom, instances: [...bloom.instances, ...veils] } } }
    const patches = choosePatches(placed, { seed })
    // Arrive just outside the threshold nearest the first patch, looking
    // through it toward that colony: the first place met is a living one.
    const home = placed.colonies.find((c) => c.index === patches[0]?.colony) ?? placed.colonies[0]
    const n = home ? [...necks].sort((p, q) => Math.hypot(p.x - home.x, p.z - home.z) - Math.hypot(q.x - home.x, q.z - home.z))[0] : necks[0]
    let arrival = null
    if (n) {
      const nearest = home
      const toward = nearest ? Math.sign((nearest.x - n.x) * n.along[0] + (nearest.z - n.z) * n.along[1]) || 1 : 1
      const back = 3.4
      const x = n.x - n.along[0] * toward * back
      const z = n.z - n.along[1] * toward * back
      const look = [n.x + n.along[0] * toward * 3, supportAt(world, n.x, n.z) + 0.45, n.z + n.along[1] * toward * 3]
      arrival = arriveAt(world, x, z, look)
    }
    return { scatter: placed, vessels: null, necks, patches, encounter: chooseEncounterBy(placed, patches), arrival }
  }
  if (space.organise === 'canopy') {
    const site = placeCanopy(world, scatter)
    const patches = choosePatches(scatter, { seed })
    if (!site) return { scatter, canopy: null, patches, encounter: chooseEncounterBy(scatter, patches), arrival: null }
    const film = new FormWriter()
    const built = buildCanopy(world, site, film)
    // Arrive some way off, three-quarters on to its open side, on land, with
    // the ground not rising between: its whole shape is not seen head on.
    const { centre, forward, right } = built.frame
    let arrival = null
    for (const dist of [9.5, 8.5, 10.5, 7.5]) {
      for (const deg of [50, -50, 38, -38, 64, -64, 25, -25]) {
        const a = (deg * Math.PI) / 180
        const dir = [forward[0] * Math.cos(a) + right[0] * Math.sin(a), forward[1] * Math.cos(a) + right[1] * Math.sin(a)]
        const x = centre[0] + dir[0] * dist
        const z = centre[1] + dir[1] * dist
        if (Math.abs(x) > 10.4 || Math.abs(z) > 10.4) continue
        if (world.groundY(...world.toUV(x, z)) <= world.waterY) continue
        const eye = supportAt(world, x, z) + 0.5
        let seen = true
        for (let t = 0.1; t < 0.6 && seen; t += 0.05) {
          const px = x + (centre[0] - x) * t
          const pz = z + (centre[1] - z) * t
          if (world.groundY(...world.toUV(px, pz)) > eye + 0.1) seen = false
        }
        if (!seen) continue
        arrival = arriveAt(world, x, z, [centre[0], supportAt(world, ...centre) + 1.1, centre[1]])
        break
      }
      if (arrival) break
    }
    return { scatter, canopy: { site, film: film.toGeometry(), met: [built.met], frame: built.frame }, patches, encounter: chooseEncounterBy(scatter, patches), arrival }
  }
  // Vessels.
  const placedVessels = placeVessels(world, scatter, { seed })
  const vessels = buildVessels(world, placedVessels)
  const patches = choosePatches(scatter, { seed })
  // Arrive on land, a little back from the land end of the vessel that best
  // leads somewhere (placeVessels' first: land and a colony across the
  // water from it), looking into it.
  let arrival = null
  const k = 0
  const v = placedVessels[k]
  if (v) {
    const end = vessels.built[k].axisAt(0)
    const x = end[0] - v.axis[0] * 2.4
    const z = end[1] - v.axis[1] * 2.4
    const look = [v.centre[0], supportAt(world, ...v.centre) + 0.5, v.centre[1]]
    arrival = arriveAt(world, x, z, look)
  }
  return { scatter, vessels: { placed: placedVessels, ...vessels }, patches, encounter: chooseEncounterBy(scatter, patches), arrival }
}
