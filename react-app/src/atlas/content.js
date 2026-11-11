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
    kicker: 'Terrain · water · air · membranes · residue · light',
    teaser: 'A ground that carries a history.',
    intro:
      'One world, shared by Explore and the Habitat: a landform cut by water veins, a record of sediment laid down before anything grows, colonies where that record allows, and the air drifting over all of it.',
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
      'Explore is the world as a design tool: change a parameter and it is generated again. The Habitat is the same composition as a place to walk through, where its lifecycles run.',
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
          { label: 'Release, residue and uptake in one patch', state: 'Development demo', note: 'bounded: one patch, behind a flag' },
          { label: 'A shared tissue between colonies', state: 'Development experiment', note: 'unfinished, paused' },
          { label: 'The tissue as form above the ground', state: 'Display studies', note: 'a fold, then a greybox; paused, not a final form' },
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
      'What form the tissue should take above the ground: a fold and a greybox were tried; the question is paused.',
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
          { number: '10', title: 'Ecological continuity', text: 'Release, residue, uptake; a shared tissue', state: 'Development demo · tissue paused', doc: 'study10', asset: 'tissueThumb' },
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
    kicker: 'Precedents · research · translation',
    teaser: 'What the world was imagined through. None of it is a render.',
    intro:
      'What the world was imagined through: works by others and biological research, each studied for one principle and translated into the world; images made to describe a direction before building it; and passes set aside along the way. None of it is a render of the world as it is.',
    hero: { asset: 'ratte2', notes: [] },
    blocks: [
      {
        type: 'precedents',
        title: 'Artistic and experiential precedents',
        note: 'External works, each studied for one quality and translated, not copied. None is a specification.',
        items: [
          {
            title: 'Plane of Incidence',
            by: 'Sabrina Ratté',
            year: '2024',
            asset: 'ratte1',
            saw: 'Translucent, ambiguous organic material, continuous with what surrounds it.',
            took: "Membranes as porous films that hold light and grow out of the colony's tissue, instead of standing on the ground.",
          },
          {
            title: 'The Ephemeral Lake',
            by: 'Jakob Kudsk Steensen',
            year: '2024',
            asset: 'ephemeral',
            saw: 'A landscape and the life in it, read as one thing changing over time.',
            took: 'Colonies that grow only where the ground and its record of sediment allow.',
          },
          {
            title: 'Journey',
            by: 'thatgamecompany',
            year: '2012',
            asset: 'journey',
            saw: 'Atmospheric light, open space and quiet, as the substance of the place.',
            took: 'Mood carried by light and air: dust and wisps in one moving air, and light held in matter. Not its palette.',
          },
          {
            title: 'ABZÛ',
            by: 'Giant Squid',
            year: '2016',
            asset: 'abzu',
            saw: 'Moving through an environment at its own scale, immersed rather than looking on.',
            took: 'A first-person presence that drifts slowly among the membranes, carried a little by the air.',
          },
          {
            title: 'Hylozoic Ground',
            by: 'Philip Beesley',
            year: '2010',
            asset: 'hylozoic',
            where: 'Canada Pavilion, Venice Architecture Biennale',
            saw: 'Thousands of light elements that sense visitors and respond, distributed through the whole space.',
            took: 'A proposal: one membrane that yields to a visitor nearby, while its own cycle carries on without them.',
          },
        ],
      },
      {
        type: 'research',
        title: 'Biological and systems research',
        note: 'Studied for how they work, not for how they look. Neither is imitated, and neither is reproduced.',
        items: [
          {
            title: 'Mycelial networks',
            basis: 'Fungal threads extend and branch through their surroundings, and some networks form pathways along which resources move.',
            borrowed: 'Growth that depends on the resources it finds; branching, fusion, redistribution, and dormancy.',
            limit: 'Not a cooperative \u201cwood-wide web\u201d: transfer between plants through shared networks is contested.',
            doc: 'study10',
          },
          {
            title: 'Turritopsis dohrnii',
            binomial: true,
            aside: 'the \u201cimmortal\u201d jellyfish',
            basis: 'Under stress, its medusa can reverse development through a cyst-like stage to a polyp, reorganising its tissue.',
            borrowed: 'Stages that need not run one way: a form loses its structure, passes through a simpler state, and later forms arise from reorganised matter.',
            limit: 'Residual Ecology does not reproduce the mechanism: nothing reverses; new forms grow from matter others released.',
            doc: 'study10',
          },
        ],
        sources: [
          { label: 'Mycelial networks: nutrient uptake, translocation and role in ecosystems (2008)', url: 'https://www.sciencedirect.com/science/article/pii/S0275028708800057' },
          { label: 'Track and trace: soil labelling and resource transport (2022)', url: 'https://link.springer.com/article/10.1007/s00572-022-01080-7' },
          { label: 'Common mycorrhizal networks: a review (2023)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10512311/' },
          { label: 'Reverse development in Turritopsis dohrnii (2019)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6893190/' },
          { label: 'Cellular reprogramming and immortality (2021)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8480191/' },
        ],
      },
      {
        type: 'translation',
        title: 'From reference to design',
        note: 'What was observed in each, what it became in the world, and how far it has got.',
        items: [
          {
            reference: 'Plane of Incidence',
            principle: 'Material that is ambiguous, and continuous with its surroundings',
            translation: "Translucent, porous membranes that hold light and emerge from the colony's tissue",
            state: 'Implemented',
            note: 'in Explore',
            doc: 'study05',
          },
          {
            reference: 'The Ephemeral Lake',
            principle: 'Landscape and living forms understood together',
            translation: 'Colonies placed by the ground and the sediment record it keeps, leaning toward the water',
            state: 'Implemented',
            note: 'in Explore',
            doc: 'study05',
          },
          {
            reference: 'Journey',
            principle: 'Light and air as the mood of a place',
            translation: 'Dust, wisps and haze in one moving air; light held in what colonies gathered',
            state: 'Implemented',
            note: 'in Explore',
            doc: 'study09',
          },
          {
            reference: 'Turritopsis dohrnii',
            principle: 'Life stages that need not run one way',
            translation: 'Residents lie down and release their matter; new residents form from the residue and take it up',
            state: 'Bounded demo',
            note: 'one patch, behind a development flag',
            doc: 'study10',
          },
          {
            reference: 'Mycelial networks',
            plain: true,
            principle: 'Growth on local resources; fusion, redistribution, dormancy',
            translation: 'A shared tissue between colonies, thickening where used and thinning to dormant traces',
            state: 'Paused',
            note: 'experimental and unfinished',
            doc: 'study10',
          },
          {
            reference: 'ABZÛ',
            principle: 'Moving through an environment at its scale',
            translation: 'A first-person presence drifting among the forms, changing nothing in them',
            state: 'Experimental',
            note: 'behind a development flag',
            doc: 'study11',
          },
          {
            reference: 'Hylozoic Ground',
            principle: 'An environment that senses and responds, without centring on the visitor',
            translation: 'One membrane yielding to a visitor nearby; its own cycle unchanged',
            state: 'Proposed',
            note: 'not built',
            doc: 'study11',
          },
        ],
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
      'Each reference was kept for one quality and translated selectively: none is a specification, and none is copied.',
      'Species, agents and migration were in the original direction; none exists.',
    ],
    questions: [
      'Whether the external works may be shown on a public site has not been checked.',
      'One material reference has no recorded source, and is left out.',
    ],
    archive: ['dreamOrganism', 'bridgework', 'branchingConcept', 'voxConcept', 'habitat', 'remains', 'readings', 'generations', 'conduitStudy'],
    archiveTitle: 'All concept studies and design boards',
    sources: ['references', 'study10', 'study11', 'direction', 'handoff'],
  },
]

export const chapterById = (id) => CHAPTERS.find((c) => c.id === id)
