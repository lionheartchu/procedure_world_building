/**
 * Wisps — rework, phase 2.5: residue carried by moving air.
 *
 * Not curves drawn through space. A few loose regions of atmosphere, each
 * holding several invisible release points that let out fine luminous
 * residue now and then, the way dye shows a current in water. The residue is
 * carried by the same field that moves the dust (lib/air.js), so the flow
 * becomes partly legible without any path being drawn:
 *
 *   - the field changes slowly over time, so what the residue traces are
 *     streak lines, not streamlines: they stretch, bend unevenly and fold
 *   - release comes in puffs with gaps, so traces start and stop
 *   - each grain wanders a little more the older it is, so a trace frays
 *     into scattered fine matter as it ages; small eddies fold it further
 *   - the release spreads and narrows over time, so a trace widens and thins
 *   - some of the residue is broad, faint mist that grows as it ages
 *
 * The drawing (components/AirWisps.jsx) adds a visibility field travelling
 * with the air, so whole sections come and go, and a staining field, so
 * colour appears locally inside the air instead of along a whole trace.
 *
 * Phase 3: each colony also has five release points upwind of it, traced
 * back along the air that will reach it, letting out thin filaments now and
 * then (like smoke in a wind tunnel): the incoming residue shows the colony
 * slowing the air, bending it round its membranes, lifting some of it and
 * letting it linger before it frays and carries on.
 *
 * Bounded: the field is divergence-free (nothing collects), the number of
 * grains is fixed, and residue is born invisible and fades in, so no source
 * is ever seen.
 */

export const WISPS = {
  sizeX: 256,
  sizeY: 256,
  regions: 5, // at Wisps 1; the default (0.5) shows 4
  sources: 7, // per region
  colonies: 6, // colonies with incoming air, at most
  perColony: 5, // release points upwind of each: thin filaments
  colonyWeight: 1.2, // grains per colony release point, relative to a region's
  mist: 0.12, // share of each source's residue that is broad mist
  warmup: 110, // seconds simulated before the first frame
  warmupStep: 0.2,
}

/** Release points: the regions' first, then the colonies'. */
export const SOURCES = WISPS.regions * WISPS.sources + WISPS.colonies * WISPS.perColony

/** Grains per release point: [first grain, count] for each, in order. */
export const SOURCE_GRAINS = (() => {
  const regionSources = WISPS.regions * WISPS.sources
  const weights = Array.from({ length: SOURCES }, (_, s) => (s < regionSources ? 1 : WISPS.colonyWeight))
  const unit = Math.floor((WISPS.sizeX * WISPS.sizeY) / weights.reduce((a, b) => a + b, 0))
  let first = 0
  return weights.map((w) => {
    const block = [first, Math.floor(unit * w)]
    first += Math.floor(unit * w)
    return block
  })
})()

/**
 * GLSL shared by the simulation and the drawing: the regions, their release
 * points, release timing and spread, the small eddies, and the visibility
 * and staining fields. Needs AIR_GLSL (lib/air.js) declared before it.
 */
export const WISPS_GLSL = /* glsl */ `
  #define SOURCES_PER_REGION ${WISPS.sources}.0
  #define REGION_SOURCES ${WISPS.regions * WISPS.sources}.0
  #define PER_COLONY ${WISPS.perColony}.0

  float wHash(float n) {
    return fract(sin(n * 12.9898 + 4.1414) * 43758.5453);
  }

  bool colonySource(float s) {
    return s > REGION_SOURCES - 0.5;
  }

  // The colony a colony release point belongs to (x, ground y, z, radius);
  // far outside the world if that colony does not exist, so nothing it
  // released then can show up later.
  vec4 sourceColony(float s) {
    float ci = floor((s - REGION_SOURCES) / PER_COLONY);
    vec4 c = vec4(1000.0, 0.0, 1000.0, 1.0);
    for (int i = 0; i < ${WISPS.colonies}; i++) {
      if (i >= uColonyCount) break;
      if (abs(float(i) - ci) < 0.5) c = uColonies[i];
    }
    return c;
  }

  // A region drifts slowly downwind across the land and comes round again,
  // each in its own band, wandering a little across it.
  vec2 regionCentre(float r, float t) {
    float z0 = r < 0.5 ? -3.6 : r < 1.5 ? 1.2 : r < 2.5 ? 5.4 : r < 3.5 ? -7.0 : -0.8;
    float x0 = wHash(r * 7.13 + 1.3) * 24.0;
    float x = -8.0 + mod(x0 + 0.03 * t, 21.0);
    float z = z0 + 1.4 * sin(0.0093 * t + r * 2.1);
    return vec2(x, z);
  }

  // Release point s: where in its region (mostly upwind of the centre), how
  // high over the ground, and a slow wander of its own.
  vec3 sourcePlace(float s, float t) {
    if (colonySource(s)) {
      // Upwind of its colony along the air that will actually reach it:
      // traced back from a point across the colony's width, so the band
      // released here arrives at the forms. Low to membrane height.
      vec4 c = sourceColony(s);
      float k = mod(s - REGION_SOURCES, PER_COLONY);
      // Irregular spacing across the colony and heights up its forms.
      float h = 0.3 + 1.5 * wHash(s * 9.13);
      float off = ((k + 0.5) / PER_COLONY - 0.5) * 1.9 + (wHash(s * 3.3) - 0.5) * 0.3;
      vec2 d0 = airWaves(vec3(c.x, c.y + h, c.z), t).xy;
      vec2 dir = length(d0) > 1e-5 ? normalize(d0) : vec2(1.0, 0.0);
      vec2 q = c.xz + vec2(-dir.y, dir.x) * off * c.w;
      for (int i = 0; i < 6; i++) {
        vec2 v = airWaves(vec3(q.x, c.y + h, q.y), t).xy;
        q -= (length(v) > 1e-5 ? normalize(v) : dir) * 0.3 * c.w;
      }
      q += vec2(0.3 * sin(0.019 * t + s * 1.3), 0.3 * sin(0.015 * t + s * 1.7));
      return vec3(q.x, h, q.y);
    }
    float r = floor(s / SOURCES_PER_REGION);
    vec2 c = regionCentre(r, t);
    // Two of the regions are broader, so the air reads across more of the world.
    float wide = (r < 0.5 || (r > 1.5 && r < 2.5)) ? 1.6 : 1.0;
    float along = mix(-4.0, 1.0, wHash(s * 3.71)) * wide;
    float across = (wHash(s * 5.31) - 0.5) * 4.4 * wide;
    vec2 wander = vec2(0.7 * sin(0.017 * t + s * 1.3), 0.7 * sin(0.013 * t + s * 1.7));
    vec2 xz = c + vec2(along, across) + wander;
    float h = 0.2 + 2.1 * pow(wHash(s * 9.13), 1.5);
    return vec3(xz.x, h, xz.y);
  }

  // Release comes in puffs: 0 between, 1 at full flow.
  float release(float s, float t) {
    float w1 = 0.045 + 0.05 * wHash(s * 2.9);
    float w2 = 0.11 + 0.05 * wHash(s * 6.7);
    float a = (0.5 + 0.5 * sin(t * w1 + s * 3.3)) * (0.55 + 0.45 * sin(t * w2 + s * 1.9));
    // A colony's incoming air flows more steadily.
    return colonySource(s) ? smoothstep(-0.1, 0.3, a) : smoothstep(0.08, 0.45, a);
  }

  // How widely residue is released: breathing between a thin trace and a spread.
  float spread(float s, float t) {
    float b = pow(0.5 + 0.5 * sin(t * (0.05 + 0.04 * wHash(s * 8.3)) + s * 4.1), 2.0);
    // A colony's incoming air is released as narrow filaments, like smoke
    // in a wind tunnel, so it shows how the air goes round the forms: soft
    // bands rather than drawn lines, which is how they read from afar.
    return colonySource(s) ? 0.13 + 0.17 * b : 0.18 + 0.6 * b;
  }

  float sourceIntensity(float s) {
    return 0.45 + 0.55 * wHash(s * 2.31);
  }

  float sourcePeriod(float s) {
    return colonySource(s) ? 75.0 + 20.0 * wHash(s * 4.93) : 70.0 + 30.0 * wHash(s * 4.93);
  }

  // Small eddies (a short-wave stream function, divergence-free).
  vec2 eddies(vec2 xz, float t) {
    vec2 v = vec2(0.0);
    vec2 k1 = vec2(1.9, 0.7);
    vec2 k2 = vec2(-0.8, 2.1);
    vec2 k3 = vec2(1.3, -1.6);
    v += cos(dot(k1, xz) + 0.21 * t) * vec2(k1.y, -k1.x) / length(k1);
    v += cos(dot(k2, xz) - 0.17 * t + 2.0) * vec2(k2.y, -k2.x) / length(k2);
    v += cos(dot(k3, xz) + 0.13 * t + 4.0) * vec2(k3.y, -k3.x) / length(k3);
    return v;
  }

  // Where the air is visible: patches travelling roughly with the drift, so
  // sections of every trace come and go.
  float visibility(vec3 p, float t) {
    vec2 q = p.xz - vec2(0.09, -0.02) * t;
    float n = sin(0.33 * q.x + 0.21 * q.y + 1.3) * sin(0.25 * q.y - 0.28 * q.x + 0.7)
            + 0.5 * sin(0.61 * q.x - 0.47 * q.y + 2.9 + 0.2 * p.y);
    return 0.12 + 0.88 * smoothstep(-0.55, 0.55, n);
  }

  // Local staining: most of the air near colourless, here and there a tint.
  float stain(vec3 p, float t) {
    vec2 q = p.xz - vec2(0.05, 0.0) * t;
    float n = sin(0.31 * q.x + 0.17 * q.y + 0.4 * p.y) * sin(0.23 * q.y - 0.19 * q.x + 1.7)
            + 0.5 * sin(0.61 * q.x + 0.47 * q.y + 3.1);
    return smoothstep(-0.1, 0.75, n);
  }

  float stainHue(vec3 p, float t) {
    return 0.5 + 0.5 * sin(0.13 * p.x - 0.21 * p.z + 0.35 * p.y + 0.4 + 0.004 * t);
  }
`
