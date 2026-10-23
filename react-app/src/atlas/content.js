/**
 * The Atlas's chapters, as data: one place for all of its words. Every
 * statement comes from the project's own documents (cited in each chapter's
 * sources). What runs only behind a development flag, and what is only
 * proposed, is said so where it appears.
 *
 * A chapter: a head (number, title, a short introduction, one annotated
 * image); its blocks; two observations and two open questions; its sources;
 * and an archive, closed by default, for the material that is not needed
 * on the page.
 *
 * Blocks:
 *   chain       linked steps in one direction (a mechanism)
 *   cycle       steps that close into a loop (a mechanism), with a status
 *   stages      a resident's stages as a timeline, with a few frames
 *   evidence    two or three chosen images
 *   status      what is built, and what is proposed
 *   studies     the studies, one line each
 *   collection  labelled items of one kind (Fragments)
 *   list        short items
 */

export const CHAPTERS = [
  {
    id: 'world',
    number: '01',
    title: 'World',
    kicker: 'Terrain · water · sediment · atmosphere',
    teaser: 'A ground that carries a history.',
    intro:
      'A ground that carries a history: a landform cut by water veins, a record of sediment laid down before anything grows, and the air drifting over all of it.',
    hero: {
      asset: 'stream',
      notes: [
        { x: 0.79, y: 0.27, title: 'Landform', text: 'Layered noise, shaped, and given relief around the water level.' },
        { x: 0.4, y: 0.62, title: 'Water vein', text: 'A spline traced downhill, then carved into the ground.' },
        { x: 0.19, y: 0.36, title: 'Colonies', text: 'They form only where the ground and the record allow.' },
      ],
    },
    blocks: [
      {
        type: 'chain',
        title: 'How it fits together',
        items: [
          { title: 'Landform', text: 'noise, shaping, relief' },
          { title: 'Water veins', text: 'traced downhill, carved in' },
          { title: 'Record', text: 'sediment, run before anything grows' },
          { title: 'Colonies', text: 'where ground and record allow' },
          { title: 'Light, tissue, air', text: 'from the matter they hold' },
        ],
        note: 'Each step reads the one before it. The chain runs one way.',
      },
      {
        type: 'evidence',
        title: 'Seen in the world',
        items: ['lightAfter', 'overview'],
      },
    ],
    observations: [
      'Explore shows a world recomputed from its parameters and a precomputed history. Its air is alive; its ecology does not develop while it is watched.',
      'The same parameters always generate the same world.',
    ],
    questions: [
      "The world's edge is still a visible square slab; the direction is a landform whose edges pass into the atmosphere.",
      'The haze, the water and the edge are aligned to the ground only approximately.',
    ],
    archive: ['history', 'flow', 'light'],
    sources: ['readme', 'study01', 'study02', 'study06', 'study07', 'study09'],
  },
  {
    id: 'life-cycles',
    number: '02',
    title: 'Life Cycles',
    kicker: 'Colonies · residents · release · renewal',
    teaser: 'Colonies are places; residents live through them.',
    intro:
      'Colonies are places, grown wherever the ground and its record allow. Residents live in them. In one experiment, a resident stands, lies down and lets go of what it holds, and a later resident rises on what remains.',
    hero: {
      asset: 'colonies',
      notes: [
        { x: 0.2, y: 0.5, dy: 2.1, title: 'Membrane', text: "Translucent, lobed frills rising out of the colony's tissue." },
        { x: 0.3, y: 0.42, dy: -2.3, title: 'Structure', text: 'Taut strands crossing between the forms.' },
        { x: 0.66, y: 0.56, side: 'right', title: 'Another colony', text: 'Nothing grows on the ground between colonies.' },
      ],
    },
    blocks: [
      {
        type: 'stages',
        title: "A resident's cycle",
        status: 'Development demo · one patch of one colony',
        stages: [
          { name: 'Forming', time: '26 s', text: 'takes matter up, unfolds as far as it allows' },
          { name: 'Holding', time: '80–140 s', text: 'stands' },
          { name: 'Lying down', time: '20 s', text: 'reclines toward the ground' },
          { name: 'Releasing', time: '28 s', text: '60% of its body leaves as films, carried by the air' },
          { name: 'Contour', time: 'stays', text: 'the other 40% remains as a faint outline' },
        ],
        frames: ['stillsLie', 'stillsSettled', 'stillsRises'],
        times: ['30 s', '62 s', '92 s'],
      },
      {
        type: 'evidence',
        title: 'What depends on the record',
        text: "With the record kept, #4 forms at 80 s on matter from #1. Switched off, the same films settle and nothing forms; erasing only #1's residue removes #4.",
        items: ['recordOn', 'recordOff'],
        layout: 'pair',
      },
    ],
    observations: [
      'The matter is all in the simulation, and a ledger of it holds throughout. A resident lying down is only drawn so.',
      'Nothing returns unchanged: a new resident leans with the deposit it rises on.',
    ],
    questions: [
      'Supply: the patch winds down after about 500 seconds, because nothing feeds it.',
      'Other colonies, and feedback to residents, are open; neither is built.',
    ],
    archive: ['record', 'languages', 'growth', 'colonyDetail'],
    sources: ['study05', 'study09', 'study10'],
  },
  {
    id: 'matter-exchange',
    number: '03',
    title: 'Matter Exchange',
    kicker: 'Release · deposition · transport · uptake',
    teaser: 'What one form lets go of becomes a condition elsewhere.',
    intro:
      'What one form lets go of becomes a condition elsewhere. In a development experiment, released matter settles, moves through a tissue in the ground, and is taken up by new growth at other colonies.',
    hero: {
      asset: 'tissueMoving',
      notes: [
        { x: 0.42, y: 0.46, dy: -2.4, title: 'Shared tissue', text: 'A band in the ground, as wide as it has been used.' },
        { x: 0.62, y: 0.6, dy: 1.4, title: 'Matter in it', text: "Pulses move at the matter's own speed, and stand still where nothing flows." },
      ],
    },
    blocks: [
      {
        type: 'cycle',
        title: 'The exchange',
        status: 'Behind development flags · not in Explore as you see it',
        items: [
          { title: 'Release', text: 'A resident lying down sheds films; part of each release enters the ground at its base.' },
          { title: 'Deposition', text: 'Settled matter joins a live record, with its source and the time it arrived.' },
          { title: 'Transport', text: 'The air carries the films; in the ground, tissue grows toward colonies with room to grow.' },
          { title: 'Uptake', text: 'A new resident forms where enough matter has waited, and takes it up.' },
        ],
      },
      {
        type: 'evidence',
        title: 'Arrival',
        text: 'With the tissue on, new residents form at colonies 1 and 2. With it off, none forms away from the first colony.',
        items: ['tissueTrunk', 'tissueRises'],
        layout: 'lead',
      },
      {
        type: 'status',
        title: 'Built, and proposed',
        items: [
          { label: 'Release, residue and uptake in one patch', state: 'Development demo', note: 'under review' },
          { label: 'A shared tissue between colonies', state: 'Development experiment', note: 'under review' },
          { label: 'The tissue as form above the ground', state: 'Display studies', note: 'a fold, then a greybox; not a final form' },
          { label: 'An emergent core; feedback to residents; history kept between sessions', state: 'Proposed', note: 'design documents only' },
        ],
      },
    ],
    observations: [
      'Nothing is lost: a ledger of every body, film, residue, contour, tissue and pocket drifts by at most 6 × 10⁻⁸.',
      'Thickening decides which paths dominate and which go dormant; it does not consistently speed delivery.',
    ],
    questions: [
      'At the default viewing distance the tissue is subtle by design.',
      'What form the tissue should take above the ground: a greybox is under review.',
    ],
    archive: ['tissueMap', 'tissueArrives', 'greyboxViews'],
    sources: ['study10', 'ecology', 'architecture'],
  },
  {
    id: 'field-notes',
    number: '04',
    title: 'Field Notes',
    kicker: 'Studies · experiments · observation',
    teaser: 'Ten studies, each kept with its notes, its successes and its failures.',
    intro:
      'A research practice rather than a finished piece: ten studies that grew into one shared world, each kept with its notes, its successes and its failures.',
    hero: {
      asset: 'branchingClose',
      notes: [
        { x: 0.74, y: 0.62, side: 'left', title: 'Micro-branching', text: 'An L-system, painted into the ground as a tissue map (study 08).' },
        { x: 0.4, y: 0.42, title: 'Structure', text: 'Strands of the colony, rooting into its ground.' },
      ],
    },
    blocks: [
      {
        type: 'chain',
        title: 'How a study is checked',
        items: [
          { title: 'A change', text: 'made in a study' },
          { title: 'Fingerprints', text: 'of the generated world, bit for bit' },
          { title: 'Frozen clock', text: 'captures from fixed cameras, pixel for pixel' },
          { title: 'Review', text: 'kept, revised or set aside' },
        ],
        note: 'Experiments run behind development flags, off by default. Set-aside passes stay on record beside the ones kept.',
      },
      {
        type: 'studies',
        title: 'The studies',
        items: [
          { number: '01', title: 'Noise / height field', text: 'A landform from one continuous function', state: 'Done', doc: 'study01' },
          { number: '02', title: 'Sediment simulation', text: 'A second field moving across the first', state: 'Done · the basis of the record', doc: 'study02' },
          { number: '03', title: 'Volume', text: 'Density fields; a grown rather than eroded morphology', state: 'Done · a separate branch', doc: 'study03', asset: 'volume' },
          { number: '04', title: 'Shaders', text: 'Three material readings of one terrain', state: 'Done', doc: 'study04' },
          { number: '05', title: 'Scatter', text: "Colonies placed by rules over the world's data", state: 'Done · refined in 09', doc: 'study05', asset: 'colonyDetail' },
          { number: '06', title: 'Water veins', text: 'Streams traced downhill and carved into the ground', state: 'Paused', doc: 'study06', asset: 'stream' },
          { number: '07', title: 'Air', text: 'A particle ecology built in reviewed layers', state: 'Checkpoint', doc: 'study07', asset: 'overview' },
          { number: '08', title: 'Branching', text: 'Residual matter becoming tissue', state: 'Checkpoint · one colony', doc: 'study08', asset: 'branchingClose' },
          { number: '09', title: 'Composition and light', text: 'Gathering colonies, light held in matter', state: 'Under review', doc: 'study09', asset: 'lightAfter' },
          { number: '10', title: 'Ecological continuity', text: 'Release, residue, uptake; a shared tissue', state: 'Development demo · under review', doc: 'study10', asset: 'tissueThumb' },
        ],
      },
    ],
    observations: [
      'Worked: colony formation, so placement reads as one organism rather than props; light diffused through the record, with no glow object.',
      'Set aside: the first branching, which read as bright lines over the terrain; a cleanup toward ultramarine and icy blue.',
    ],
    questions: [
      'Screenshots for studies 01, 02 and 04 were never captured.',
      'The haze still reads as a separate layer from low angles.',
    ],
    archive: ['greyboxTried', 'explore'],
    sources: ['readme', 'status', 'architecture', 'backlog'],
  },
  {
    id: 'fragments',
    number: '05',
    title: 'Fragments',
    kicker: 'Influences · proposals · set-aside material',
    teaser: 'What the world was imagined through. None of it is a render.',
    intro:
      'What the world was imagined through: works by others, images made to describe a direction before building it, and passes set aside along the way. None of it is a render of the world as it is.',
    hero: { asset: 'ratte2', notes: [] },
    blocks: [
      {
        type: 'collection',
        title: 'Influences',
        note: 'External works, each kept for one quality. None is a specification.',
        items: ['ephemeral', 'journey'],
      },
      {
        type: 'collection',
        title: 'Proposals',
        note: 'AI-generated images, made to describe a direction before it was built. They are not renders of the app, and not evidence that anything they show exists.',
        items: ['membraneBloom', 'body'],
      },
      {
        type: 'collection',
        title: 'Set aside',
        note: 'From the project itself: passes that were tried and left. No hand sketches are kept in the repository.',
        items: ['branchingFirst', 'foldSection'],
      },
      {
        type: 'list',
        title: 'Possibilities',
        note: 'From the status report: directions, not plans.',
        items: [
          'Decay: colonies that thin, collapse into residue and seed what follows.',
          'A live history: the record and the colonies developing over minutes rather than being recomputed.',
          'Water that carries light, in lavender and pearl.',
        ],
      },
    ],
    observations: [
      'Each reference was kept for one quality: materiality, atmosphere, or time.',
      'Species, agents and migration were in the original direction; none exists.',
    ],
    questions: [
      'Whether the external works may be shown on a public site has not been checked.',
      'One material reference has no recorded source, and is left out.',
    ],
    archive: ['dreamOrganism', 'bridgework', 'branchingConcept', 'voxConcept', 'habitat', 'remains', 'readings', 'generations', 'conduitStudy', 'ratte1', 'abzu'],
    archiveTitle: 'All concept studies, design boards and references',
    sources: ['references', 'direction', 'handoff'],
  },
]

export const chapterById = (id) => CHAPTERS.find((c) => c.id === id)
