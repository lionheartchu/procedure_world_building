/**
 * The project's documents that the Atlas cites. Published ones (on the
 * repository's main branch) link there; the others exist only in the local
 * working copy so far, and are named by path, not linked.
 */

const REPO = 'https://github.com/lionheartchu/procedure_world_building/blob/main/'

export const DOCS = {
  readme: { title: 'README', path: 'README.md', published: true },
  direction: { title: 'Project direction', path: 'PROJECT_DIRECTION.md', published: true },
  aesthetic: { title: 'Aesthetic language', path: 'AESTHETIC_LANGUAGE.md', published: true },
  status: { title: 'Project status, October 2026', path: 'docs/project-status-2026-10.md', published: true },
  architecture: { title: 'Architecture and interface', path: 'docs/architecture.md', published: true },
  backlog: { title: 'Backlog', path: 'backlog.md', published: true },
  references: { title: 'References', path: 'docs/references/README.md', published: true },
  study01: { title: '01 · Noise / height field', path: 'docs/01-noise-study.md', published: true },
  study02: { title: '02 · Sediment simulation', path: 'docs/02-sediment-simulation.md', published: true },
  study03: { title: '03 · Volume', path: 'docs/03-voxel-study.md', published: true },
  study04: { title: '04 · Shaders', path: 'docs/04-shader-study.md', published: true },
  study05: { title: '05 · Scatter', path: 'docs/05-scatter-study.md', published: true },
  study06: { title: '06 · Water veins', path: 'docs/06-passages-study.md', published: true },
  study07: { title: '07 · Air', path: 'docs/07-air-study.md', published: true },
  study08: { title: '08 · Branching', path: 'docs/08-branching-study.md', published: true },
  study09: { title: '09 · Composition and light', path: 'docs/09-composition-and-light.md', published: true },
  study10: { title: '10 · Ecological continuity', path: 'docs/10-lifecycle-concept.md', published: false },
  handoff: { title: 'Design handoff', path: 'docs/01-PROJECT-HANDOFF.md', published: false },
  ecology: { title: 'Ecological logic', path: 'docs/02-ECOLOGICAL-LOGIC.md', published: false },
  atlas: { title: 'Atlas: content and asset map', path: 'docs/atlas-content.md', published: false },
}

/** Where a document can be read online, or null while it is local only. */
export const docUrl = (key) => {
  const doc = DOCS[key]
  return doc?.published ? REPO + doc.path.split('/').map(encodeURIComponent).join('/') : null
}
