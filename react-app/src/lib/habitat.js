import { DEFAULT_PARAMS, DEFAULT_SCATTER, DEFAULT_SIM, SCATTER_GROUND } from '../worldDefaults'
import { chooseResidents } from './lifecycle'
import { FOLD } from './habitatSpaces'
import { shallows } from './habitatWorld'

/**
 * The Habitat, v0 (docs/12-habitat-v0.md): a curated world to be in, in
 * first person. It is Explore's own world, derived by the same code, with
 * what it depends on pinned here, so a change to Explore's defaults never
 * moves it.
 *
 * The world: seed 42, colony seed 7, 40 s of History. Four colonies: three
 * gathered in the south (0–2, one place), one alone on the northern bank
 * (3), with a shallow basin, an islet and a peninsula between.
 */
export const HABITAT = {
  params: { ...DEFAULT_PARAMS, seed: 42, elevation: 2.7, waterLevel: 0.5, resolution: 224 },
  simParams: { ...DEFAULT_SIM },
  scatter: { ...DEFAULT_SCATTER, view: 'all', seed: 7, history: 40, growth: 1, streams: 2 },
  ground: { ...SCATTER_GROUND, underwater: 0 },
  /** The air: Explore's defaults, without the air's own skins (only the lifecycle's films fly). */
  air: { density: 0.6, drift: 0.5, curl: 0.5, wisps: 0.5, wispStrength: 0.5, colony: 0.6, haze: 0.5, fragments: false },
  /**
   * Two lifecycle patches, each its own simulation with its own residual
   * grid: matter in one never reaches the other (their colonies are 17
   * units apart, and neither patch reads the other's ground).
   *   - colony 0: study 10's patch as it is (its first holds 14, 110, 210 s)
   *   - colony 3: its one free veil, first holding 90 s, so the two are out of
   *     step from the start: a starting state of its own, not a delay
   */
  patches: [
    { colony: 0, seed: 7 },
    { colony: 3, seed: 10, holds: [90] },
  ],
  /** The warm accent on real exchanges (LifecycleLayer WARM): 1, at the edge. */
  warm: 1,
  /** The encounter: on the northern colony, its tallest veil that no patch takes. */
  encounter: { colony: 3 },
  /** Where the visitor arrives: on the islet, between the two places, looking south at the gathered colonies. */
  arrival: { p: [4.4, 0, 1.4], look: [0.4, 0.55, 7.6] },
  /** Rendering: first person needs no thumbnail buffer and no orbit; the pixel ratio is capped. */
  render: { dpr: [1, 1.5], preserve: false, orbit: false, fog: 0.03 },
  /** Films: the back-lit rim and fold light fade within these distances of the camera (units). */
  nearFade: [0.8, 4.0],
}

/** The encounter's membrane: the colony's tallest secondary veil that no lifecycle patch takes as a resident. */
export function chooseEncounter(scatter, colony) {
  const residents = new Set(chooseResidents(scatter, colony))
  return (
    scatter.layers.bloom.instances
      .filter((b) => b.colony === colony && b.role === 'secondary' && !residents.has(b))
      .sort((a, b) => b.height - a.height)[0] ?? null
  )
}

/* --- spatial studies (docs/13-habitat-spaces.md) -------------------------- */

/**
 * The Habitat's spaces: v0 (the baseline above) and two spatial studies.
 * Each study is a world configuration plus one organising rule; its
 * patches, encounter and arrival are chosen by rule from whatever world
 * that configuration makes (lib/habitatSpaces.js), not from colony indices.
 *
 * Everything not listed here (air, rendering, controls, body) is the same
 * for all three, so they compare as spaces.
 */
const STUDY = {
  simParams: HABITAT.simParams,
  scatter: HABITAT.scatter,
  ground: HABITAT.ground,
  air: HABITAT.air,
  warm: HABITAT.warm,
  render: HABITAT.render,
  nearFade: HABITAT.nearFade,
  waterCue: true,
}

export const SPACES = {
  v0: { ...HABITAT, key: 'v0', organise: null, waterCue: false },
  /**
   * A, terrain-led: the landform folded at its midline (the `ridge` shaping)
   * into long low banks around shallow pockets, the water raised to meet
   * them. Chosen by a search for 40–70% land, at least three enclosed
   * pockets, little open water at the edge and at least three colonies:
   * seed 3 gave 65% land, five pockets, five colonies. Its vertical scale
   * is lowered (2.7 → 1.8) so the banks stand about twice eye height (90th
   * percentile 0.9 above the water) at a median slope of 28° rather than
   * 39°: banks to be among, not mountains. The fold's crest is rounded
   * (FOLD), which removes the ridge's saw-tooth crests and widens the banks,
   * so the water is raised a little (0.6 → 0.64): 72% land, five colonies,
   * five necks, two separate patches. Thresholds (pairs of veils) stand
   * at the necks between pockets.
   */
  a: {
    ...STUDY,
    key: 'a',
    title: 'A · terrain-led',
    params: { ...DEFAULT_PARAMS, seed: 3, shaping: 'ridge', shapingOp: FOLD, shapingAmount: 1.8, waterLevel: 0.64, landformScale: 1.8, elevation: 1.8, resolution: 224 },
    organise: 'thresholds',
  },
  /**
   * B, tissue-led: an open landform (the default `power` shaping, broad and
   * unfolded, the water a little lower), with three vessels across its
   * shores. Chosen by a search for 45–72% land where three vessels that
   * lead to land across the water, and two separate patches, fit: seed 3
   * gave 64% land and five colonies. (A shares the seed, not the landform:
   * its scale and shaping differ.)
   */
  b: {
    ...STUDY,
    key: 'b',
    title: 'B · tissue-led',
    params: { ...DEFAULT_PARAMS, seed: 3, shaping: 'power', shapingAmount: 1.2, waterLevel: 0.42, elevation: 2.7, resolution: 224 },
    organise: 'vessels',
  },
  /**
   * C, soft basin and emergent canopy (docs/14-habitat-c.md): a gently
   * varied landform with shallow pockets, and one large asymmetric membrane
   * rooted into a bank and opening over the shallows. Chosen by a search for
   * a median slope ≤ 12° (90th percentile ≤ 22°), 50–82% land, enclosed
   * shallow water, little open water at the edge, two separate patches and a
   * place for the canopy: seed 11 gave 80% land, four pockets (90% of the
   * water within 0.31 of the surface), slopes 10° (median) and 20° (90th
   * percentile), five colonies. Moves smoothly (presence.js SMOOTH).
   */
  c: {
    ...STUDY,
    key: 'c',
    title: 'C · soft basin, emergent canopy',
    params: { ...DEFAULT_PARAMS, seed: 11, shaping: 'power', shapingAmount: 1.0, waterLevel: 0.44, landformScale: 1.8, elevation: 1.9, resolution: 224 },
    organise: 'canopy',
    motion: 'smooth',
  },
  /**
   * C1, the working foundation (docs/16-habitat-foundation.md): C's world
   * and ecology, moving smoothly, in the foundation look, with the giant
   * canopy retired (still composed, so the arrival and the comparison
   * viewpoints are C's, but neither drawn nor met), and the far field drawn
   * in the slab ground's own material (Terrain `farGround`).
   */
  c1: {
    ...STUDY,
    key: 'c1',
    title: 'C1 · foundation (working)',
    params: { ...DEFAULT_PARAMS, seed: 11, shaping: 'power', shapingAmount: 1.0, waterLevel: 0.44, landformScale: 1.8, elevation: 1.9, resolution: 224 },
    organise: 'canopy',
    motion: 'smooth',
    lookKey: 'foundation',
    hideCanopy: true,
    farTerrain: true,
  },
  /**
   * D, a distributed living world (docs/17-habitat-d.md): 48 units of rises
   * and connected shallows instead of 26, colonies across them in groups and
   * alone, each begun at its own age, and a horizon of low hills and a far
   * range. Chosen by a search (seeds 1–16, water 0.53/0.56, the landform
   * drawn out, with the shallows) for 35–60% water mostly in one connected body, 90% of it
   * under 0.5 deep, gentle land, colonies on three or more rises in all four
   * quarters with some alone and some grouped (unevenly spaced), and five
   * or more lifecycles: seed 12 gave 45% water (85% of it connected, 90% of
   * it within 0.2 of the surface), slopes 5° (median) and 13° (90th
   * percentile), and thirteen colonies.
   */
  d: {
    ...STUDY,
    key: 'd',
    title: 'D · distributed (first playable)',
    size: 48,
    bound: 22.6,
    params: {
      ...DEFAULT_PARAMS,
      seed: 12,
      shaping: 'power',
      shapingAmount: 1.0,
      shapingOp: shallows({ level: 0.56, keep: 0.4 }),
      stretch: { ratio: 0.55, angle: 0.4 },
      relief: { deepen: 0.05, shelf: 0.004 },
      waterLevel: 0.56,
      landformScale: (1.8 * 48) / 26,
      detailScale: (6.4 * 48) / 26,
      elevation: 1.9,
      resolution: 416,
      historyRes: 256,
    },
    // More membranes to a colony than elsewhere (bloomAmount 0.85, not 0.5):
    // D's colonies are many and small, and at 0.5 each had one veil free
    // to live a lifecycle; at 0.85, two or three.
    scatter: { ...STUDY.scatter, streams: 3, streamFlow: 0.6, bloomAmount: 0.85, colonyMax: 16, gatherBy: 'land', deplete: 0.75 },
    organise: 'distributed',
    motion: 'smooth',
    lookKey: 'open',
    farTerrain: true,
    /** The oldest colony has lived this long (simulated seconds) when the visitor arrives; see colonyAges. */
    age: { span: 900 },
    /** Residue no colony holds: up to this many places (strayResidue's own rule). */
    residue: { most: 14 },
    /** The land past the slab (lib/farField.js horizonRise). */
    horizon: {
      seed: 12,
      reach: 46,
      widest: 6,
      sinkFrom: 28,
      sinkTo: 60,
      sink: 0.25,
      flatten: 0.3,
      ring: { inner: 44, outer: 250, segments: 360, rings: 40 },
      hills: { from: 40, to: 75, height: 4, scale: 0.03 },
      range: { from: 95, to: 150, height: 15, scale: 0.012, fall: [200, 240] },
    },
  },
}

/**
 * D1 (docs/18-habitat-d1.md): D's world exactly — the same landform,
 * colonies, ages, lifecycles and rules — seen in a look with more depth
 * (`open1`), and with the lifecycles' passage drawn to be read from eye
 * height (`legible`: a film laid over the scene rather than screened, the
 * mark it leaves on its resident, a resident bent by the air its films
 * ride, and the warm accent's whole passage, variant 6). Nothing in the
 * ecology differs from D.
 */
SPACES.d1 = {
  ...SPACES.d,
  key: 'd1',
  title: 'D1 · hierarchy, one legible passage',
  lookKey: 'open1',
  legible: true,
  warm: 6,
}

/* --- visual comparisons (docs/15-habitat-c-visual.md) ---------------------- */

/**
 * Looks to compare on any Habitat page (`?look=soft`); none by default, so
 * every space looks as it did. Each changes only existing values:
 *
 *   - openness: the scene's membrane openness (bloomOpenness), below the
 *     point where the film shader cuts lace (open × 1.6 < 0.35), so no
 *     membrane is perforated; the closed sheet's light thin spots fainter
 *   - films a little quieter (their gain), so they are not near white
 *   - ground: untouched ground in the Dormant reading less dark (0.38 of the
 *     ramp → 0.62), the shadow grading's navy push eased, the water's veil
 *     thinned toward violet (Explore's own Underwater visibility)
 *   - sky, fog and background from near-black navy toward violet, the water
 *     reflecting the same horizon, the far field in the same tones; the sky
 *     dome written in the output colour space (Atmosphere `encode`), which
 *     in Explore it is not, so it shows about three times darker than its
 *     authored colours
 */
export const LOOKS = {
  soft: {
    openness: 0.2,
    form: { filmGain: 0.72, spots: 0.35 },
    ground: { dormant: 0.56, grade: 0.5, underwater: 0.3, water: 0.82, skyHorizon: '#4E4A82' },
    render: { background: '#141228', haze: '#35325F', sky: { horizon: '#4E4A82', zenith: '#110F25', encode: true } },
    far: { low: '#5A5690', high: '#7671A8', submerged: '#3A3766', sink: 0.5, flatten: 0.45 },
  },
  /**
   * The working foundation's look (docs/16-habitat-foundation.md): soft's
   * corrections kept (the sky written in the output colour space and moved
   * to violet, the ground lifted, perforation reduced), with tonal depth
   * given back — a darker zenith, more of the shadow grading, deeper water,
   * a little less mist and fog — and openness only just under the lace
   * threshold, so the few most open veils (the ones farthest up from the
   * water, where placement meant lace) keep a few small openings.
   */
  foundation: {
    openness: 0.3,
    form: { filmGain: 0.8, spots: 0.4 },
    ground: { dormant: 0.5, grade: 0.65, underwater: 0.22, water: 0.85, skyHorizon: '#4A4680', edgeQuiet: 1 },
    render: { background: '#100E22', haze: '#2D2A54', fog: 0.026, sky: { horizon: '#4A4680', zenith: '#0C0A1D', encode: true } },
    air: { haze: 0.35 },
    far: { sink: 0.5, flatten: 0.45 },
  },
}

/**
 * D's look: open. The sky light at the horizon and deepening upward (three
 * stops, as the earlier Trace Habitat's), a pearl glow low on the side the
 * light comes from, pale violet haze so distance lightens rather than
 * darkens, thinner fog so the far colonies and the range read, the ground
 * lifted to sit under that sky, the water reflecting it, and no drawn
 * waterline (the visitor's ring stays).
 */
LOOKS.open = {
  openness: 0.3,
  form: { filmGain: 0.8, spots: 0.4 },
  ground: {
    dormant: 0.85,
    grade: 0.35,
    underwater: 0.3,
    water: 0.8,
    skyHorizon: '#D6CFEA',
    skyZenith: '#8A84C0',
    waterShallow: '#6A64A6',
    waterDeep: '#4D4890',
    // The ramp lifted (D's water is shallow, so its bed lies in what was the
    // dark submerged band; here it is a violet a step below the wet margin),
    // and the ground's own light paler and less blue: the dim blue light the
    // other looks use multiplied with the violet ramp into deep indigo.
    colours: {
      uDeepBasin: '#4A4682',
      uSubmerged: '#6E68A6',
      // Wet ground a little darker than dry, never a pale band at the shore.
      uWetMargin: '#7A74AF',
      uFlats: '#8A84BA',
      uMidLavender: '#A39CCD',
      uCrest: '#D2CBEE',
      uSkyAmbient: '#AFA9D6',
      uGroundAmbient: '#5A5590',
      uLightColor: '#E2DBF1',
    },
    edgeQuiet: 1,
    cueLine: 0,
    farDissolve: [215, 248],
  },
  render: {
    background: '#D6CFEA',
    haze: '#C3BCE0',
    fog: 0.0105,
    far: 420,
    sky: { horizon: '#DAD3EC', mid: '#B2AAD9', zenith: '#827CBB', glow: '#EEEAF6', glowDir: [-0.6, 0, -0.55], encode: true },
  },
  air: { haze: 0.35 },
}

/**
 * M1 (docs/19-collective-morphogenesis.md): an exploration, not a world. D1
 * exactly, with one addition: the lifecycles share a commons (lib/morph.js),
 * a cue breathed into the air where a film comes away and carried downwind,
 * which residents gather and answer by their own state. Two new rules,
 * here only; matter, its accounting and every other rule as in D1. The cue
 * is drawn as tinted air (components/MorphAir.jsx).
 */
SPACES.m1 = {
  ...SPACES.d1,
  key: 'm1',
  title: 'M1 · a shared cue in the air (exploration)',
  morph: true,
}

/**
 * M2 (docs/20-cue-flow.md): M1's simulation exactly, drawn differently. The
 * cue is not drawn as puffs (MorphAir) but in the air's own wisps
 * (AirWisps `cue`): their idle release points let out the cue's air where
 * films have lately come away, and every wisp grain passing through the
 * simulated cue takes its colour; the wisps' colony air follows the
 * visitor's nearest colonies. A visual exploration; nothing simulated
 * differs from M1.
 */
SPACES.m2 = {
  ...SPACES.m1,
  key: 'm2',
  title: 'M2 · the cue in the moving air (visual exploration)',
  cueAir: 'wisps',
}

/**
 * The Habitat that `/habitat` opens: the site's own, where its Habitat tab
 * leads. Featuring another space means changing only this; every space
 * keeps its own route, `/habitat/<key>`, as well.
 */
export const FEATURED = 'm2'

/**
 * M3 (docs/21-habitat-m3.md): M2 with three changes, none to the ecology:
 *   - the thin white line where the slab meets the far ground sealed (a
 *     skirt hung from the far ground's inner edge: `seal`, buildFarField)
 *   - calmer water (`open2`): D1's swell and bed darkening made broad
 *     blotches and far bands; both eased, the depth kept
 *   - the cue drawn the same wherever the visitor stands (`cueGlobal`: the
 *     most active, not the nearest), and the residue and old contours drawn
 *     by how long they have lain (`residueAge`), so the ecology's recent
 *     past reads at any moment
 */
SPACES.m3 = {
  ...SPACES.m2,
  key: 'm3',
  title: 'M3 · coherent ground, readable time (exploration)',
  lookKey: 'open2',
  seal: 0.6,
  cueGlobal: true,
  residueAge: true,
}

/**
 * D1's look: open, given depth. The same sky, a step less white at the
 * horizon, its glow no longer clipping on the light's side; a thicker haze a
 * shade deeper than the horizon, so distance lightens into layered
 * silhouettes instead of white; the ground lit on its smooth normal with its
 * relief read more steeply, damp near the water and deeper under it, the
 * record paler where it lies; water reflecting a little less sky; and the
 * forms that lie on the ground (residue, footings, the colonies' skin) lit
 * by the ground's own light, not the darker light the other looks use.
 */
const OPEN1_LIGHT = { sky: '#A29CCE', ground: '#5A5590', color: '#E2DBF1' }
LOOKS.open1 = {
  ...LOOKS.open,
  form: {
    ...LOOKS.open.form,
    light: {
      // Plates and grains part of the way: fully lit they read as pale glass among the veils.
      sediment: { sky: '#8C86C0', ground: '#4D497A', color: '#CDC6E8' },
      solid: OPEN1_LIGHT,
      // The colonies' ground skin part of the way (fully lit it read as a white disc); the residue fully.
      tissue: { sky: '#837DB8', ground: '#47436F', color: '#C6BFE4' },
      deposit: OPEN1_LIGHT,
      // Strands lifted only part of the way: they stay the darkest line in a colony, its structure.
      tension: { sky: '#77729F', ground: '#3B3866', color: '#B6AFD8' },
    },
  },
  ground: {
    ...LOOKS.open.ground,
    smoothLight: 1,
    reliefLight: 1.6,
    // Damp band (units above the water), how much darker, its sheen, the bed's depth scale.
    wet: [0.15, 0.3, 0.3, 0.08],
    dryTint: [1.05, 1.0, 0.99],
    recordGain: 0.35,
    colours: { ...LOOKS.open.ground.colours, uSkyAmbient: '#A29CCE', uSedimentTint: '#CEC6EA' },
    skyHorizon: '#CFC7E6',
    reflect: 0.9,
    skyLift: 0.06,
    // The water a deeper violet than the ground beside it, and more of a
    // veil, so near water lies over the bed as a surface of its own and far
    // water turns to the sky it reflects.
    waterShallow: '#544E98',
    waterDeep: '#463F88',
    veil: [0.38, 0.58],
    swell: 2.2,
  },
  render: {
    ...LOOKS.open.render,
    haze: '#BCB4DC',
    fog: 0.019,
    sky: { horizon: '#D3CBE8', mid: '#B0A8D8', zenith: '#827CBB', glow: '#EDE6F3', glowDir: [-0.6, 0, -0.55], glowGain: 0.45, encode: true },
  },
}

/**
 * M3's look: D1's, with the water calmer. D1's swell (2.2) laid the sky's
 * gradient over the shallows in broad light and dark blotches, and its bed
 * darkened over 0.08 units of depth, so every ripple of the shallow bed
 * showed as a band. The swell is D's again (0.9) and the bed deepens over
 * 0.2 units: the water stays deeper than the ground beside it.
 */
LOOKS.open2 = {
  ...LOOKS.open1,
  ground: {
    ...LOOKS.open1.ground,
    swell: 0.9,
    wet: [0.15, 0.3, 0.3, 0.2],
  },
}

/**
 * M3R (docs/21-habitat-m3.md, "M3R"): M3 at close range. Its world,
 * simulation, palette and light exactly; what changes is how they read from
 * a visitor's eye height:
 *   - the shoreline: the water's depth from the ground exactly as the
 *     terrain draws it (`exactDepth`; the simulation's 8-bit, coarser copy
 *     cut its edge into steps), and the damp ground running on under the
 *     water (`wetJoin`; D1's damp band stopped at the line, a hard edge)
 *   - the water: as opaque as the eye's path through it (`clear`: shallows
 *     seen from above clear to their bed, water at a slant dense), with a
 *     fine ripple near the eye; the ground a fine grain there (`nearGrain`)
 *   - a sheet near the eye thinning (`nearAlpha`), so passing one does not
 *     fill the view with a pale wall
 *   - the lifecycle residents drawn for close range (`closeRange`,
 *     LifecycleLayer): their posture rising and opening, sagging, lying
 *     down onto the ground under them, as one bend that keeps the sheet's
 *     length; their sheet closed but where their films left
 */
LOOKS.open3 = {
  ...LOOKS.open2,
  form: { ...LOOKS.open2.form, nearAlpha: [0.35, 1.3, 0.3] },
  ground: {
    ...LOOKS.open2.ground,
    exactDepth: true,
    wetJoin: 1,
    clear: [0.22, 0.35, 1.2, 5],
    nearGrain: [0.3, 1.5, 5],
  },
}

SPACES.m3r = {
  ...SPACES.m3,
  key: 'm3r',
  title: 'M3R · close range (refinement of M3)',
  lookKey: 'open3',
  closeRange: true,
}

/**
 * M3E (docs/22-habitat-m3e.md): M3R with one encounter, a prototype. Its
 * world, simulation and look are M3R's, with:
 *   - `encounter`: whichever standing resident the visitor comes near yields
 *     to them, as its own tension (its matter, its stage) has it
 *     (ResidentEncounter, lib/encounter.js); nothing it does reaches the
 *     lifecycle
 *   - `kinFilms`: the films a resident releases drawn as pieces of its own
 *     sheet, as large as the matter they carry (the air's opal skins read as
 *     soap bubbles)
 *   - `unstick`: walking along or under a form no longer braked by the body's
 *     height spring pressing into it (lib/presence.js)
 *   - `live` (look): a live site's light in the membranes' own pale tone, not
 *     mint, which on these pale skies read as the cue's ice blue
 */
LOOKS.open3e = {
  ...LOOKS.open3,
  form: { ...LOOKS.open3.form, live: '#DCD5F2' },
}

SPACES.m3e = {
  ...SPACES.m3r,
  key: 'm3e',
  title: 'M3E · an encounter (prototype)',
  lookKey: 'open3e',
  encounter: true,
  kinFilms: true,
  unstick: true,
}

/** A space with a look applied (or as it is). */
export function withLook(space, look) {
  if (!look) return space
  return {
    ...space,
    scatter: { ...space.scatter, bloomOpenness: look.openness ?? space.scatter.bloomOpenness },
    ground: { ...space.ground, ...look.ground },
    render: { ...space.render, ...look.render },
    air: { ...space.air, ...look.air },
    look,
  }
}
