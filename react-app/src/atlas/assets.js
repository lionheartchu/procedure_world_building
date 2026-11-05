/**
 * Every image the Atlas shows, from where the project keeps it (docs/), with
 * what it is. The kind is shown with each image, so an app capture is never
 * mistaken for a design study or someone else's work. Captions follow the
 * studies' own descriptions; nothing here was made for the Atlas, except the
 * portal's five illustrations (PORTAL, below), which say so.
 *
 * A crop ([x, y, w, h] in the image's pixels) shows one panel of a labelled
 * comparison sheet, below its burned-in label.
 */

// App captures and diagrams (docs/images).
import overview from '../../../docs/images/07-p6-default.png'
import explore from '../../../docs/images/explore-2026-10.png'
import stream from '../../../docs/images/06-stream.png'
import flow from '../../../docs/images/06-flow.png'
import history from '../../../docs/images/05-history.png'
import colonies from '../../../docs/images/05-colony.png'
import colonyDetail from '../../../docs/images/05-colony-detail.png'
import languages from '../../../docs/images/05-languages.png'
import growth from '../../../docs/images/05-growth.png'
import light from '../../../docs/images/09-overview.png'
import branchingClose from '../../../docs/images/08r-close.png'
import branchingFirst from '../../../docs/images/08-close.png'
import volume from '../../../docs/images/03-cohesive-fractured.png'
import stills from '../../../docs/images/10-stage2-stills.png'
import record from '../../../docs/images/10-stage2-record.png'
import stageApp from '../../../docs/images/10-stage2-app.png'
import tissueMap from '../../../docs/images/10-tissue-map.png'
import tissueClose from '../../../docs/images/10-tissue-close.png'
import greyboxTried from '../../../docs/images/10-greybox-tried.png'
import greyboxViews from '../../../docs/images/10-greybox-views.png'
import foldSection from '../../../docs/images/10-fold-section.png'
// AI-generated concept studies (docs/references/concept-studies).
import dreamOrganism from '../../../docs/references/concept-studies/Dream Organism.png'
import bridgework from '../../../docs/references/concept-studies/Bridgework.png'
import membraneBloom from '../../../docs/references/concept-studies/Membrane Bloom.png'
import branchingConcept from '../../../docs/references/concept-studies/branching2.png'
import voxConcept from '../../../docs/references/concept-studies/vox-ref1.png'
// AI-generated design studies for the lifecycle (docs/references).
import habitat from '../../../docs/references/01-habitat.png'
import remains from '../../../docs/references/02.png'
import readings from '../../../docs/references/03.png'
import body from '../../../docs/references/04-body1.png'
import generations from '../../../docs/references/05-body2.png'
import conduitStudy from '../../../docs/references/conduit-01.png'
// External references (docs/references).
import ratte1 from '../../../docs/references/Plane of Incidence1.jpg'
import ratte2 from '../../../docs/references/Plane of Incidence2.png'
import journey from '../../../docs/references/journey.jpg'
import abzu from '../../../docs/references/abzu2.webp'
import ephemeral from '../../../docs/references/The Ephemeral Lake.webp'
import hylozoic from '../../../docs/references/Hylozoic Ground.png'
// The portal's five chapter illustrations: tightly cropped, web-sized copies of the
// originals in docs/references/atlas-layout (kept unchanged there).
import worldIllustration from './portal/world.webp'
import lifeIllustration from './portal/life-cycles.webp'
import exchangeIllustration from './portal/matter-exchange.webp'
import notesIllustration from './portal/field-notes.webp'
import fragmentsIllustration from './portal/fragments.webp'

/** What each kind is, as shown beside the image. */
export const KINDS = {
  capture: 'App capture',
  data: 'From simulation data',
  diagram: 'Technical diagram',
  concept: 'AI-generated concept study',
  design: 'AI-generated design study · proposed behaviour',
  external: 'External reference',
  drawing: 'Drawn for the Atlas from project data',
  illustration: 'Conceptual illustration · not a screenshot or simulation evidence',
}

/** One panel of the lifecycle demo's labelled sequence, below its label. */
const STILLS_ROW = 2745 / 7
const still = (row, time, caption) => ({
  src: stills,
  size: [1246, 2745],
  crop: [0, Math.round(row * STILLS_ROW) + 42, 618, Math.round(STILLS_ROW) - 46],
  kind: 'capture',
  doc: 'study10',
  alt: `The lifecycle demo at ${time}, with the record kept: ${caption}`,
  caption,
})

export const ASSETS = {
  overview: {
    src: overview,
    size: [1600, 1000],
    kind: 'capture',
    doc: 'study07',
    alt: 'The default overview: one atmosphere over the habitat, soft residue bands across the middle ground, mist low in the basins',
    caption: 'One atmosphere over the habitat: residue bands carried by moving air, mist low in the basins.',
  },
  explore: {
    src: explore,
    size: [1600, 1000],
    kind: 'capture',
    doc: 'readme',
    alt: 'The app as it opens: a lavender landscape under soft haze, pale translucent colonies, fine particles in the air, and the Explore panel on the right',
    caption: 'The app as it opens on Explore, with its panel. 14 October 2026.',
  },
  stream: {
    src: stream,
    size: [1400, 875],
    kind: 'capture',
    doc: 'study06',
    alt: 'A broad, shallow translucent stream lying in a soft channel, widening toward the basin, with pale forms on the bank',
    caption: 'A water vein lying in its channel, widening as it runs down toward the basin.',
  },
  flow: {
    src: flow,
    size: [1932, 400],
    kind: 'capture',
    doc: 'study06',
    alt: 'Streams 0 (no channel), Flow 0 (a narrow stream) and Flow 1 (a small brook), same camera',
    caption: 'No stream, a narrow stream, a small brook: the same camera.',
  },
  history: {
    src: history,
    size: [1932, 400],
    kind: 'capture',
    doc: 'study05',
    alt: 'History 0, 40 and 120 seconds: young colonies, then established ones',
    caption: 'History at 0, 40 and 120 seconds: young colonies, then established ones.',
  },
  colonies: {
    src: colonies,
    size: [1600, 1000],
    kind: 'capture',
    doc: 'study05',
    alt: 'Five colonies on the default landform: lobed membrane frills rising out of pale tissue, taut strands crossing between them, empty ground between colonies',
    caption: 'Colonies on the default landform. Nothing was placed by hand, and nothing at random either.',
  },
  colonyDetail: {
    src: colonyDetail,
    size: [1280, 602],
    kind: 'capture',
    doc: 'study05',
    alt: "The near colony: one lobed frill rising out of the colony's tissue, a rib up its tallest crest, granular crust around its base",
    caption: "One lobed frill rising out of the colony's tissue, a rib up its tallest crest, crust around its base.",
  },
  languages: {
    src: languages,
    size: [1932, 1046],
    kind: 'capture',
    doc: 'study05',
    alt: 'Each language solo (top) and where it may grow (bottom), with the colony rings and what was placed',
    caption: 'Each language alone (top), and where it may grow (bottom).',
  },
  growth: {
    src: growth,
    size: [1932, 806],
    kind: 'capture',
    doc: 'study05',
    alt: 'Growth 0.25 to 1.0: tissue spreading, frills unfurling, structure reaching',
    caption: 'Growth from 0.25 to 1: tissue spreading, frills unfurling, structure reaching.',
  },
  light: {
    src: light,
    size: [1606, 500],
    kind: 'capture',
    doc: 'study09',
    alt: 'Before and after the composition and light pass: colonies gather around a first, fuller colony and light is held in the ground around them',
    caption: 'Before and after the composition and light pass.',
  },
  lightAfter: {
    src: light,
    size: [1606, 500],
    crop: [806, 52, 800, 446],
    kind: 'capture',
    doc: 'study09',
    alt: 'Colonies gathered around a first, fuller colony, with light held in the ground around them',
    caption: 'Light held in the matter the colonies laid down, not cast from a source.',
  },
  branchingClose: {
    src: branchingClose,
    size: [1600, 1000],
    kind: 'capture',
    doc: 'study08',
    alt: "A close-up about two units from a colony's anchor: fine pale micro-branching lying in the colony's ground, partly beneath its surface",
    caption: "Close, about two units from a colony's anchor: micro-branching lying in its ground, partly beneath the surface.",
  },
  branchingFirst: {
    src: branchingFirst,
    size: [1600, 1000],
    kind: 'capture',
    doc: 'study08',
    alt: 'The first branching pass: fine luminous roots spreading from a colony across the ground',
    caption: 'The first branching pass, set aside: it read as bright lines laid over the terrain.',
  },
  volume: {
    src: volume,
    size: [1856, 923],
    crop: [40, 150, 1380, 760],
    kind: 'capture',
    doc: 'study03',
    alt: 'The volume study: a continuous mass with local fracture',
    caption: 'The volume study: a continuous mass with local fracture.',
  },
  stillsLie: still(1, '30 s', '#1 lies down.'),
  stillsSettled: still(3, '62 s', 'Its films have settled: a faint contour, and residue beside it.'),
  stillsRises: still(5, '92 s', '#4 rises on the residue and takes it up.'),
  recordOn: {
    src: stageApp,
    size: [1210, 962],
    crop: [0, 513, 600, 445],
    kind: 'capture',
    doc: 'study10',
    alt: 'At 94 s with the record kept: #4 stands on the residue',
    caption: 'Record kept: at 94 s, #4 stands on the residue.',
  },
  recordOff: {
    src: stageApp,
    size: [1210, 962],
    crop: [610, 513, 598, 445],
    kind: 'capture',
    doc: 'study10',
    alt: 'At 94 s with the record switched off: the same films settled, nothing has formed',
    caption: 'Record off: the same films settled, and nothing forms.',
  },
  record: {
    src: record,
    size: [848, 1314],
    kind: 'data',
    doc: 'study10',
    alt: "The record from the simulation's data: with feedback on, #1's residue lies by its contour and #4 rises from it; with it off, the same films settle and nothing forms",
    caption: "From the simulation's data: the residue, the contour and the new resident, with the record kept, off, and with only #1's residue erased.",
  },
  tissueMap: {
    src: tissueMap,
    size: [1448, 764],
    kind: 'data',
    doc: 'study10',
    alt: "Top down, from the simulation's data: the tissue begins at #1's base, explores and branches, reaches colonies 1 and 2 and fuses, thickens along the paths that carry most, and thins elsewhere",
    caption: "Top down, 90 to 900 s: the tissue begins where matter entered the ground, reaches colonies 1 and 2, thickens where it carries most and thins elsewhere.",
  },
  tissueTrunk: {
    src: tissueMap,
    size: [1448, 764],
    crop: [0, 400, 478, 342],
    kind: 'data',
    doc: 'study10',
    alt: 'The shared tissue at 400 s, top down: the paths that carry most have thickened into a trunk',
    caption: '400 s, top down: the paths that carry most have thickened into a trunk.',
  },
  tissueThumb: {
    src: tissueMap,
    size: [1448, 764],
    crop: [970, 400, 478, 342],
    kind: 'data',
    doc: 'study10',
    alt: 'The shared tissue at 900 s, top down: dormant traces remain',
    caption: '900 s: dormant traces remain.',
  },
  tissueArrives: {
    src: tissueClose,
    size: [1608, 1008],
    crop: [0, 22, 800, 478],
    kind: 'capture',
    doc: 'study10',
    alt: 'At colony 1, 276 s: the tissue arrives and its pocket fills',
    caption: '276 s, colony 1: the tissue arrives; its pocket fills.',
  },
  tissueRises: {
    src: tissueClose,
    size: [1608, 1008],
    crop: [806, 22, 802, 478],
    kind: 'capture',
    doc: 'study10',
    alt: 'At colony 1, 300 s: a new resident rises from what the tissue carried',
    caption: '300 s, colony 1: a new resident rises from what the tissue carried.',
  },
  tissueMoving: {
    src: tissueClose,
    size: [1608, 1008],
    crop: [0, 528, 800, 470],
    kind: 'capture',
    doc: 'study10',
    alt: 'Near colony 2 at 296 s: a pale band of tissue in the ground, with matter moving inside it',
    caption: '296 s, near colony 2: matter moving inside the tissue.',
  },
  greyboxTried: {
    src: greyboxTried,
    size: [2262, 474],
    kind: 'capture',
    doc: 'study10',
    alt: 'Five forms tried for the tissue above ground before the one kept, in plain grey, close and low',
    caption: 'Five forms tried for the tissue above ground before the one kept, in plain grey: geometry before material.',
  },
  greyboxViews: {
    src: greyboxViews,
    size: [2230, 814],
    kind: 'capture',
    doc: 'study10',
    alt: 'The tissue greybox at 300 s beside the ground-level tissue, in five views',
    caption: 'The tissue greybox beside the ground-level tissue, in five views.',
  },
  foldSection: {
    src: foldSection,
    size: [1080, 983],
    kind: 'diagram',
    doc: 'study10',
    alt: 'The fold study section, to scale: a long trailing edge, a hump, a crest that rolls over an undercut, an inner skin',
    caption: 'A fold study for the tissue, in section, as built; superseded by the greybox.',
  },
  dreamOrganism: {
    src: dreamOrganism,
    size: [1448, 1086],
    kind: 'concept',
    doc: 'references',
    alt: 'Concept study, Dream Organism: a trace-grown colony',
    caption: 'Dream Organism: growth as trace, gather, accrete, wrap. Guidance for study 05.',
  },
  membraneBloom: {
    src: membraneBloom,
    size: [1448, 1086],
    kind: 'concept',
    doc: 'references',
    alt: 'Concept study, Membrane Bloom: translucent skins, folded blooms, apertures',
    caption: 'Membrane Bloom: translucent skins, folded blooms, apertures. Loose guidance for the membranes of study 05.',
  },
  bridgework: {
    src: bridgework,
    size: [1448, 1086],
    kind: 'concept',
    doc: 'references',
    alt: 'Concept study, Bridgework: spans, tensile connections, porous structure',
    caption: 'Bridgework: spans, tensile connections. For study 05.',
  },
  branchingConcept: {
    src: branchingConcept,
    size: [1448, 1086],
    kind: 'concept',
    doc: 'references',
    alt: 'Concept study for branching at a colony: beaded roots, veins rising into the membranes',
    caption: 'Branching at a colony: beaded roots, veins rising into the membranes. For study 08.',
  },
  voxConcept: {
    src: voxConcept,
    size: [1672, 941],
    kind: 'concept',
    doc: 'references',
    alt: 'Concept study for the volume: a lobed mass with few large openings',
    caption: 'Cohesive substrate: a lobed mass, few large openings. For study 03.',
  },
  habitat: {
    src: habitat,
    size: [1536, 1024],
    kind: 'design',
    doc: 'handoff',
    alt: 'Design board 01, One shared habitat: local endings change distant beginnings',
    caption: 'One shared habitat: local endings change distant beginnings.',
  },
  remains: {
    src: remains,
    size: [1536, 1024],
    kind: 'design',
    doc: 'handoff',
    alt: 'Design board 02, What remains becomes a condition: one place, six moments',
    caption: 'What remains becomes a condition: one place, six moments.',
  },
  readings: {
    src: readings,
    size: [1536, 1024],
    kind: 'design',
    doc: 'handoff',
    alt: 'Design board 03, Three readings of time: age, present state, and the history of a place',
    caption: 'Three readings of time: age, present state, and the history of a place.',
  },
  body: {
    src: body,
    size: [1536, 1024],
    kind: 'design',
    doc: 'handoff',
    alt: 'Design board 04, The ground has a body: residents emerge on a body that outlasts them',
    caption: 'The ground has a body: residents emerge on a body that outlasts them. A proposal; the emergent core it shows is not built.',
  },
  generations: {
    src: generations,
    size: [1536, 1024],
    kind: 'design',
    doc: 'handoff',
    alt: 'Design board 05, One body, many generations: continuity does not mean an unchanging state',
    caption: 'One body, many generations: continuity does not mean an unchanging state.',
  },
  conduitStudy: {
    src: conduitStudy,
    size: [1448, 1086],
    kind: 'design',
    doc: 'study10',
    alt: 'Design board, Shared conduit study: local release can support distant emergence',
    caption: 'Shared conduit study: local release can support distant emergence.',
  },
  ratte2: {
    src: ratte2,
    size: [1818, 1022],
    kind: 'external',
    doc: 'references',
    credit: 'Sabrina Ratté, Plane of Incidence (2024)',
    alt: 'Sabrina Ratté, Plane of Incidence',
    caption: 'Kept for translucent, ambiguous materiality, and forms continuous with their surroundings. The primary visual inspiration.',
  },
  ratte1: {
    src: ratte1,
    size: [600, 338],
    kind: 'external',
    doc: 'references',
    credit: 'Sabrina Ratté, Plane of Incidence (2024)',
    alt: 'Sabrina Ratté, Plane of Incidence',
    caption: 'Accumulated organic structures and rich micro-detail.',
  },
  ephemeral: {
    src: ephemeral,
    size: [2499, 1406],
    kind: 'external',
    doc: 'references',
    credit: 'Jakob Kudsk Steensen, The Ephemeral Lake (2024)',
    alt: 'Jakob Kudsk Steensen, The Ephemeral Lake',
    caption: 'Kept for traces of time: a form and its environment, read together.',
  },
  journey: {
    src: journey,
    size: [1280, 720],
    kind: 'external',
    doc: 'references',
    credit: 'Journey, thatgamecompany (2012)',
    alt: 'Journey, thatgamecompany',
    caption: 'Kept for atmosphere only: luminous water and air. Not its cyan palette.',
  },
  hylozoic: {
    src: hylozoic,
    size: [1400, 550],
    kind: 'external',
    doc: 'references',
    credit: 'Philip Beesley, Hylozoic Ground (2010)',
    alt: 'Philip Beesley, Hylozoic Ground',
    caption: 'Kept for an environment that senses visitors and responds.',
  },
  abzu: {
    src: abzu,
    size: [1024, 576],
    kind: 'external',
    doc: 'references',
    credit: 'ABZÛ, Giant Squid (2016)',
    alt: 'ABZÛ, Giant Squid',
    caption: 'Kept for atmosphere only: immersion, depth and wonder.',
  },
}

/**
 * The portal's five chapter illustrations. Conceptual images supplied for
 * the Atlas: they give each chapter an identity, and are not screenshots of
 * the app nor evidence from its simulation. `size` is the cropped copy's
 * pixels (its visible content, with a little margin).
 */
export const PORTAL = {
  world: {
    src: worldIllustration,
    size: [960, 582],
    alt: 'Conceptual illustration for World: a softly layered, translucent island',
  },
  'life-cycles': {
    src: lifeIllustration,
    size: [896, 960],
    alt: 'Conceptual illustration for Life Cycles: a translucent lavender form like a sail, rising from a small base',
  },
  'matter-exchange': {
    src: exchangeIllustration,
    size: [960, 591],
    alt: 'Conceptual illustration for Matter Exchange: a strip of ground with a pale conduit running through it, carrying points of champagne light',
  },
  'field-notes': {
    src: notesIllustration,
    size: [935, 811],
    alt: 'Conceptual illustration for Field Notes: sheets of sketches and material observations, with a small pinned print',
  },
  fragments: {
    src: fragmentsIllustration,
    size: [960, 778],
    alt: 'Conceptual illustration for Fragments: a small collection of prints and translucent material pieces',
  },
}
