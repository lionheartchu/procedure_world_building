import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildHeightGrid } from '../lib/field'
import { SED_DISPLAY, SIM_RES } from '../lib/sediment'
import { STREAM_RES } from '../lib/streams'
import { PALETTE, RAMP } from '../lib/palette'

export const FIELD_SIZE = 26

// The simulation runs on its own fixed clock so its behaviour does not change
// with frame rate or with the render grid resolution.
const SIM_STEP = 1 / 30
const MAX_STEPS_PER_FRAME = 3

/** How much of a unit of sediment shows up as actual elevation. Kept small. */
const SEDIMENT_LIFT = 1

/** Hash-based value noise, shared by the terrain and the water. */
const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`

/**
 * Reflected water light: broad, slow, coherent patches, 0..1.
 *
 * One field, sampled by both the ground and the water surface, so the light on
 * the basin floor and the sheen on the water above it are the same event.
 * A strong, very slow domain warp gives the shapes their irregular, drifting
 * outline; a threshold on a two-octave field makes them patches with soft
 * edges (about a third of the area); a finer drifting grain breaks up their
 * interior so they shimmer rather than sit as flat blobs. Features are a few
 * units across — the scale of a basin, not of a facet.
 */
const REFLECTED_LIGHT_GLSL = /* glsl */ `
  float reflectedLight(vec2 p, float t) {
    vec2 w = vec2(
      valueNoise(p * 0.16 + vec2(t * 0.012, 0.0)),
      valueNoise(p * 0.16 + vec2(7.1, -t * 0.010))
    ) - 0.5;
    vec2 q = p + w * 5.0;
    float f = valueNoise(q * 0.42 + vec2(t * 0.030, t * 0.018)) * 0.65
            + valueNoise(q * 0.95 + vec2(3.3 - t * 0.022, t * 0.030)) * 0.35;
    float body = smoothstep(0.46, 0.70, f);
    float grain = 0.72 + 0.28 * valueNoise(q * 2.1 + vec2(t * 0.05, -t * 0.04));
    return body * grain;
  }
`

const colorUniform = (rgb) => ({ value: new THREE.Color(rgb[0], rgb[1], rgb[2]) })
const hexUniform = (hex) => ({ value: new THREE.Color(hex) })

/**
 * Height-aware terrain shader.
 *
 * Colour comes from the base height relative to the water line (the ramp is
 * mirrored from `palette.js`), normals are derived per-fragment so the surface
 * stays faceted, and the sediment texture both lifts the surface slightly and
 * tints it. Mint appears only where the simulation is currently moving
 * material.
 */
function createTerrainMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSediment: { value: null },
        uFieldSize: { value: FIELD_SIZE },
        uSedScale: { value: SED_DISPLAY },
        uSedLift: { value: 1 },
        uElevation: { value: 1 },
        uWaterLevel: { value: 0.5 },

        uDeepBasin: colorUniform(RAMP.deepBasin),
        uSubmerged: colorUniform(RAMP.submerged),
        uWetMargin: colorUniform(RAMP.wetMargin),
        uFlats: colorUniform(RAMP.flats),
        uMidLavender: colorUniform(RAMP.midLavender),
        uCrest: colorUniform(RAMP.crest),
        uSedimentTint: hexUniform('#B4ADD8'),
        uMint: hexUniform(PALETTE.moonlitMint),
        uHaze: hexUniform('#5E5C93'),

        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
        uLightColor: hexUniform('#8E88C0'),
        uSkyAmbient: hexUniform('#4C4A7E'),
        uGroundAmbient: hexUniform('#22243F'),

        // Material mode. 0 is the Field view and is left exactly as it was;
        // 1-3 are the shader study's three readings of the same terrain.
        uMode: { value: 0 },
        uTime: { value: 0 },
        uHeightInfluence: { value: 1 },
        uStrata: { value: 0.45 },
        // Slope rank of this landform (45th and 85th percentiles of
        // 1 - normal.y), so strata show on *its* steeper faces.
        uExposureLo: { value: 0.03 },
        uExposureHi: { value: 0.1 },
        uActivityInfluence: { value: 0.7 },
        // Scatter's base revision: height hierarchy and body in the value.
        // 0 everywhere else, so the Shaders tab's Dormant is unchanged.
        uRelief: { value: 0 },
        // Water veins: damp banks, settled material and flow, on a finer
        // grid than the sediment record. Shared by every tab.
        uStream: { value: null },
        uPulse: { value: 0.5 },
        uFresnel: { value: 0.7 },
        uMembrane: { value: 0.5 },
        uMembraneDeep: hexUniform('#3A3A5C'),
        uMembranePale: hexUniform('#C6BFE6'),
        uRim: hexUniform('#A9B0E8'),
        uWaterY: { value: 0 },
        uCaustics: { value: 0 },
        uCaustic: hexUniform('#B7B2E0'),
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float aHeight;

      uniform sampler2D uSediment;
      uniform float uFieldSize;
      uniform float uSedScale;
      uniform float uSedLift;
      uniform float uMode;
      uniform float uTime;
      uniform float uPulse;
      uniform float uMembrane;

      varying float vHeight;
      varying float vSediment;
      varying float vActivity;
      varying vec3 vWorldPos;
      varying vec3 vSmoothNormal;

      #include <common>
      #include <fog_pars_vertex>

      void main() {
        vSmoothNormal = normalize(mat3(modelMatrix) * normal);

        // Field coordinates, matching field.sample(u, v) exactly.
        vec2 fuv = position.xz / uFieldSize + 0.5;
        vec4 sed = texture2D(uSediment, fuv);

        vSediment = sed.r * uSedScale;
        vActivity = sed.g;
        vHeight = aHeight;

        // Modes 2 and 3 add a little movement. Deliberately tiny — a few
        // percent of the terrain's range — so the geometry stays comparable
        // between modes and only the material really changes.
        float breathe = 0.0;
        if (uMode > 1.5 && uMode < 2.5) {
          // Dormant: only ground that has collected something breathes.
          breathe = sin(uTime * 0.35 + position.x * 0.18 + position.z * 0.14)
                  * uPulse * vSediment * 0.6;
        } else if (uMode > 2.5) {
          // Membrane: a slow drift across the whole surface.
          breathe = sin(uTime * 0.22 + position.x * 0.31)
                  * cos(uTime * 0.17 + position.z * 0.27)
                  * uMembrane * 0.09;
        }

        vec3 transformed = position;
        transformed.y += vSediment * uSedLift + breathe;

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uWaterLevel;
      uniform float uSedScale;
      uniform float uElevation;

      uniform vec3 uDeepBasin;
      uniform vec3 uSubmerged;
      uniform vec3 uWetMargin;
      uniform vec3 uFlats;
      uniform vec3 uMidLavender;
      uniform vec3 uCrest;
      uniform vec3 uSedimentTint;
      uniform vec3 uMint;
      uniform vec3 uHaze;

      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform vec3 uSkyAmbient;
      uniform vec3 uGroundAmbient;

      uniform float uMode;
      uniform float uTime;
      uniform float uHeightInfluence;
      uniform float uStrata;
      uniform float uExposureLo;
      uniform float uExposureHi;
      uniform float uActivityInfluence;
      uniform float uRelief;
      uniform sampler2D uStream;
      uniform float uFieldSize;
      uniform float uPulse;
      uniform float uFresnel;
      uniform float uMembrane;
      uniform float uWaterY;
      uniform float uCaustics;
      uniform vec3 uCaustic;
      uniform vec3 uMembraneDeep;
      uniform vec3 uMembranePale;
      uniform vec3 uRim;

      varying float vHeight;
      varying float vSediment;
      varying float vActivity;
      varying vec3 vWorldPos;
      varying vec3 vSmoothNormal;

      #include <common>
      #include <fog_pars_fragment>

      /** Cheap smooth mottling. Sines rather than a hash: no grain, no tables. */
      float softNoise(vec3 p) {
        return sin(p.x * 1.7 + sin(p.z * 1.3 + 2.1))
             * sin(p.z * 1.1 + sin(p.y * 0.9))
             * 0.5 + 0.5;
      }

      ${NOISE_GLSL}
      ${REFLECTED_LIGHT_GLSL}

      // Mirrors sedimentColor() in lib/palette.js.
      vec3 rampColor(float d) {
        vec3 c = uDeepBasin;
        c = mix(c, uSubmerged, smoothstep(-0.35, -0.06, d));
        c = mix(c, uWetMargin, smoothstep(-0.06, 0.0, d));
        c = mix(c, uFlats, smoothstep(0.0, 0.12, d));
        c = mix(c, uMidLavender, smoothstep(0.10, 0.34, d));
        c = mix(c, uCrest, smoothstep(0.32, 0.60, d));
        return c;
      }

      void main() {
        // Faceted normals from screen-space derivatives (core in WebGL2), so
        // vertex displacement never needs a normal rebuild on the CPU.
        vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (n.y < 0.0) n = -n;
        // Smooth vertex normal, for everything that should not see facets:
        // the membrane's softness and where water light can land.
        vec3 ns = normalize(vSmoothNormal);

        // Shared reads. Every mode draws on some subset of these and nothing
        // else, which is what keeps the three readings comparable.
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
        float wrap = dot(n, uLightDir) * 0.5 + 0.5;
        float facing = clamp(dot(n, viewDir), 0.0, 1.0);
        float rim = pow(1.0 - facing, 3.0);
        float sed = clamp(vSediment / uSedScale, 0.0, 1.0);
        float act = clamp(vActivity, 0.0, 1.0);
        // Only real accumulation counts; a thin dusting reads as nothing.
        float residueMask = smoothstep(0.12, 0.62, sed);
        // Depth below the (tidal) water line, as a fraction of the relief.
        float E = max(uElevation, 0.001);
        float dn = (uWaterY - vWorldPos.y) / E;
        // Water veins: damp banks (R), settled material (G), flow (B).
        vec4 stream = texture2D(uStream, clamp(vWorldPos.xz / uFieldSize + 0.5, 0.0, 1.0));
        float channel = smoothstep(0.02, 0.25, stream.r);

        // Each mode writes the lit surface and, separately, anything emissive
        // or reflected. Environmental light (caustics) only ever touches the
        // lit surface, so it cannot amplify mint or sheen.
        vec3 lit;
        vec3 emit = vec3(0.0);

        if (uMode < 0.5) {
          // 0 — Field view. Height ramp, sediment tint, mint on active flow.
          vec3 base = rampColor(vHeight - uWaterLevel);
          base = mix(base, uSedimentTint, pow(sed, 0.75) * 0.6);
          lit = base * (ambient + uLightColor * wrap);
          lit += uHaze * rim * 0.3;
          lit += uMint * pow(act, 1.3) * 0.5;

        } else if (uMode < 1.5) {
          // A — Geological. Height, normal and world position only; static.
          //
          // Form first, bedding second. About nine broad beds across the
          // relief, each fading into the next over nearly half its thickness,
          // so there is never a line between them. They dip gently one way
          // and are folded by a slow warp, so on a hillside they cross the
          // contours at an angle instead of tracing them. They show only on
          // the steeper faces, ranked against this landform's own slopes;
          // flats and basin floors stay plain.
          //
          // The previous pass drew a thin dark parting at every bed boundary.
          // Beds cut at a constant height are, in plan, contour lines, so the
          // partings drew a topographic map over the terrain.
          float h = (vHeight - uWaterLevel) * uHeightInfluence;
          float exposure = 1.0 - clamp(n.y, 0.0, 1.0);
          float exposureS = 1.0 - clamp(ns.y, 0.0, 1.0);

          vec2 dip = vec2(0.055, 0.025);
          float fold = (valueNoise(vWorldPos.xz * 0.07 + 2.0) - 0.5) * 1.2
                     + (valueNoise(vWorldPos.xz * 0.19 + 9.0) - 0.5) * 0.35;
          float bedCoord = ((vWorldPos.y + dot(vWorldPos.xz, dip)) / E + 0.5) * 9.0 + fold;
          // Beds alternate harder (paler) and softer (darker), each with its
          // own amount, so neighbours always differ but never evenly.
          float bedIndex = floor(bedCoord);
          float toneA = 0.5 + (mod(bedIndex, 2.0) - 0.5) * (0.45 + 0.55 * hash21(vec2(bedIndex, 3.7)));
          float toneB = 0.5 + (mod(bedIndex + 1.0, 2.0) - 0.5) * (0.45 + 0.55 * hash21(vec2(bedIndex + 1.0, 3.7)));
          float tone = mix(toneA, toneB, smoothstep(0.5, 1.0, fract(bedCoord)));
          // Darker beds a touch cooler, paler ones a touch greyer.
          vec3 bedTint = mix(vec3(0.74, 0.75, 0.84), vec3(1.2, 1.17, 1.15), tone);

          // Smooth normal, so exposure varies across the form rather than
          // flickering facet by facet. Beds also thin out along their length
          // (lens), as real layers pinch out, which breaks the repetition.
          float exposed = smoothstep(uExposureLo, uExposureHi, exposureS);
          float lens = 0.7 + 0.3 * valueNoise(vWorldPos.xz * 0.08 + 13.0);
          float farFade = 1.0 - smoothstep(0.3, 0.7, fwidth(bedCoord));
          float show = uStrata * exposed * lens * farFade;

          vec3 base = rampColor(h);
          base *= mix(vec3(1.0), bedTint, show);

          // Mineral grain. Two scales, barely there — enough that the surface
          // is not flat colour, not enough to read as texture.
          float grain = softNoise(vWorldPos * 3.1) * 0.6 + softNoise(vWorldPos * 8.3) * 0.4;
          base *= 0.95 + grain * 0.1;

          // Ground at and below the water line reads wet: darker, denser.
          float wet = 1.0 - smoothstep(-0.03, 0.2, vWorldPos.y - uWaterY);
          base = mix(base, base * 0.7, wet * 0.5);
          base = mix(base, base * 0.74, exposure * 0.45);

          lit = base * (ambient + uLightColor * wrap);
          lit += uHaze * rim * 0.2;

        } else if (uMode < 2.5) {
          // B — Dormant / residual. Untouched ground stays dark whatever the
          // controls say: both the residue and the pulse are behind a
          // threshold on sediment, so a thin dusting reads as nothing and only
          // real accumulation lights up. The pulse never touches the base.
          vec3 dormant = mix(rampColor(vHeight - uWaterLevel) * 0.38, uDeepBasin, 0.25);
          vec3 residue = mix(dormant, uSedimentTint * 0.85, residueMask * uActivityInfluence);
          lit = residue * (ambient + uLightColor * wrap * 0.7);

          // The glow belongs to the deposit rather than being laid over it:
          // it takes the surface's own shading (smooth normal, so it follows
          // the form without facets), and a deposit seen through water glows
          // dimmer the deeper it lies. Flat, unshaded emission was what made
          // it read as projected.
          float held = 0.6 + 0.6 * (dot(ns, uLightDir) * 0.5 + 0.5);
          float through = dn > 0.0 ? 0.55 + 0.45 * exp(-dn * 3.0) : 1.0;

          // Slow and spatial, so it travels across the ground rather than
          // flashing the whole scene at once.
          float pulse = 0.65 + 0.35 * sin(uTime * 0.4 + vWorldPos.x * 0.11 + vWorldPos.z * 0.08);
          emit += uSedimentTint * residueMask * residueMask * uPulse * 0.18 * pulse * held * through;
          emit += uMint * pow(act, 1.6) * uPulse * 0.9 * pulse * held * through;

          // Relief (Scatter only): the landform given body. Plateaus stand
          // paler than the ground below them; the rounded shoulder where a
          // slope turns over into a top catches light, as a thick edge does;
          // the steep foot just above the water sits in its own shade. All on
          // the smooth normal, so it follows form, not facets.
          if (uRelief > 0.0) {
            // A stream's own channel walls are not landform, so the shoulder
            // light must not catch them: it outlined every carved channel in
            // a pale ring.
            float above = vHeight - uWaterLevel;
            float plateau = smoothstep(0.02, 0.35, above);
            float shoulder = smoothstep(0.5, 0.82, ns.y) * (1.0 - smoothstep(0.9, 0.99, ns.y))
                           * smoothstep(0.0, 0.08, above) * (1.0 - channel);
            float foot = (1.0 - smoothstep(0.0, 0.12, above)) * smoothstep(0.12, 0.45, 1.0 - ns.y) * (1.0 - channel);
            lit *= mix(1.0, mix(0.82, 1.45, plateau) * (1.0 - 0.3 * foot), uRelief);
            lit = mix(lit, lit * vec3(1.04, 1.0, 1.12), plateau * uRelief);
            emit += uSedimentTint * shoulder * 0.12 * uRelief;
          }

        } else {
          // C — Living membrane. The normal is pushed around by a slow
          // low-frequency field before anything is measured against it. That
          // decorrelation is the whole trick: read straight off the faceted
          // normal, the highlight traces every facet edge and the surface
          // looks like a wireframe. Perturbed, the light pools and slides
          // instead.
          float e = 0.35;
          vec3 q = vWorldPos * 0.28 + vec3(0.0, uTime * 0.035, uTime * 0.018);
          float d0 = softNoise(q);
          vec3 grad = vec3(
            softNoise(q + vec3(e, 0.0, 0.0)) - d0,
            softNoise(q + vec3(0.0, e, 0.0)) - d0,
            softNoise(q + vec3(0.0, 0.0, e)) - d0
          );
          // Built on the smooth normal: a membrane has no facets.
          vec3 nS = normalize(ns + grad * (0.6 + uMembrane * 1.2));

          float facingS = clamp(dot(nS, viewDir), 0.0, 1.0);
          // A broad falloff, not a rim: exponent 1.7 rather than 3, and scaled
          // well down, so strong settings read as sheen instead of outline.
          float sheen = pow(1.0 - facingS, 1.7);
          vec3 halfDir = normalize(uLightDir + viewDir);
          float wetSpec = pow(max(dot(nS, halfDir), 0.0), 18.0);
          // Thin-sheet transmission: looking toward the light, grazing parts
          // of the sheet let a little of it through, as if thin there.
          float trans = pow(clamp(dot(viewDir, -uLightDir), 0.0, 1.0), 2.0)
                      * pow(1.0 - facingS, 2.0);

          float wrapS = dot(nS, uLightDir) * 0.5 + 0.5;
          vec3 membrane = mix(uMembraneDeep, uMembranePale, 0.35 + d0 * 0.4);
          lit = membrane * (ambient * 1.1 + uLightColor * wrapS * 0.55);
          // Under water the sheet reads denser, so the waterline survives a
          // material that is pale everywhere.
          float submergedM = smoothstep(0.0, 0.12 * uElevation, uWaterY - vWorldPos.y);
          lit *= 1.0 - submergedM * 0.4;
          emit += uRim * sheen * uFresnel * 0.32;
          emit += uMembranePale * wetSpec * uFresnel * 0.5;
          emit += uRim * trans * uFresnel * 0.3;
        }

        // Shared across the study modes: reflected water light on the ground.
        //
        // Reaches every submerged surface, fading with depth measured as a
        // fraction of the terrain's relief (so it behaves the same on any
        // landform), and spills a short way up the banks, which is where
        // light off water is most visible in reality. The two sides meet at
        // full strength at the water line, so there is no seam there. Ground
        // facing up catches more of it, via the smooth normal so facets do
        // not speckle it. It brightens the surface already lit — the
        // material keeps its values — plus a small lavender lift.
        //
        // The first version was a thin band 0-0.45 units deep, times a
        // facing threshold, times a pattern covering ~12%: together about
        // 1-2% of the terrain, then half-hidden by the water above. That is
        // why the slider did almost nothing.
        // Water veins, in every reading of the ground: the banks a stream
        // keeps damp are darker and cooler, and the material it settles
        // along them is paler and finer. The water itself is its own
        // surface, lying in the channel.
        // Moderate: darker banks made the water a dark crease in the ground.
        lit *= 1.0 - 0.28 * stream.r;
        lit *= mix(vec3(1.0), vec3(0.9, 0.94, 1.1), stream.r);
        lit = mix(lit, lit * 1.25 + uSedimentTint * 0.03, stream.g * 0.6);

        if (uCaustics > 0.0 && uMode > 0.5) {
          float reach = dn >= 0.0 ? exp(-dn * 3.5) : 1.0 - smoothstep(0.0, 0.06, -dn);
          float receive = 0.35 + 0.65 * clamp(ns.y, 0.0, 1.0);
          float c = reflectedLight(vWorldPos.xz, uTime) * reach * receive * uCaustics;
          if (uMode > 1.5 && uMode < 2.5) {
            // Dormant: the light gathers in the deposits. Gated by residue
            // and purely multiplicative, so dark untouched ground barely
            // catches it and it emerges with the sediment, slowly, instead of
            // sitting over the basin as a separate layer.
            lit += lit * c * (0.15 + 0.85 * residueMask) * 1.3;
          } else {
            // Membrane is already pale, so the same light reads stronger.
            float modeGain = uMode > 2.5 ? 0.55 : 1.0;
            lit += (lit * 0.85 + uCaustic * 0.07) * c * modeGain;
          }
        }

        gl_FragColor = vec4(lit + emit, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The shared water surface for the shader study.
 *
 * A separate environmental layer, not part of any material mode. It reads as
 * water through a few restrained cues, all of which the terrain lacks:
 *
 *   - it knows its own depth (ground height rides in the simulation texture),
 *     so it thins to nothing at the shore and thickens over the basins
 *   - it is smoother than the ground: one very slow, low-frequency tilt
 *     instead of facets, and no vertex motion at all
 *   - it reflects the sky gradient (the same indigo-to-horizon ramp as the
 *     backdrop), weighted by a Schlick Fresnel, so near water is see-through
 *     and far water turns into sky
 *
 * No reflection pass, no refraction, no render target.
 */
function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSim: { value: null },
        uFieldSize: { value: FIELD_SIZE },
        uElevation: { value: 1 },
        uSedScale: { value: SED_DISPLAY },
        uSedLift: { value: 1 },
        uTime: { value: 0 },
        uWater: { value: 0.6 },
        uLight: { value: 0 },
        uClarity: { value: 1 },
        uShallow: hexUniform('#2E3160'),
        uDeepWater: hexUniform('#141735'),
        uHorizon: hexUniform('#4A4E84'),
        uZenith: hexUniform('#0C0F26'),
        uGlint: hexUniform('#C9C3EC'),
        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;

      #include <common>
      #include <fog_pars_vertex>

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSim;
      uniform float uFieldSize;
      uniform float uElevation;
      uniform float uSedScale;
      uniform float uSedLift;
      uniform float uTime;
      uniform float uWater;
      uniform float uLight;
      uniform float uClarity;
      uniform vec3 uShallow;
      uniform vec3 uDeepWater;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uGlint;
      uniform vec3 uLightDir;

      varying vec3 vWorldPos;

      #include <common>
      #include <fog_pars_fragment>

      ${NOISE_GLSL}
      ${REFLECTED_LIGHT_GLSL}

      /** Two drifting octaves, so the surface never repeats as a wave. */
      float swell(vec2 p) {
        return valueNoise(p * 0.22 + vec2(uTime * 0.018, uTime * 0.011)) * 0.65
             + valueNoise(p * 0.51 + vec2(-uTime * 0.014, uTime * 0.021) + 7.3) * 0.35;
      }

      void main() {
        // Depth under this point: the ground height is in the sim texture's
        // B channel, sediment in R. The plane is exactly the terrain's
        // footprint, and fades out over its last few percent so the water
        // never shows a square edge — it belongs to the basins, not to a sea
        // the terrain sits in.
        vec2 fuv = vWorldPos.xz / uFieldSize + 0.5;
        vec4 sim = texture2D(uSim, clamp(fuv, 0.0, 1.0));
        // B carries the ground height over -0.5…1.5: the relief lifts land
        // above 1 and deepens basins below 0, which 0…1 clipped.
        float ground = (sim.b * 2.0 - 1.0) * uElevation + sim.r * uSedScale * uSedLift;
        float depth = vWorldPos.y - ground;
        if (depth <= 0.0) discard;
        vec2 edgeDist = min(fuv, 1.0 - fuv);
        float bounds = smoothstep(0.0, 0.06, min(edgeDist.x, edgeDist.y));

        // Offset and widened: the ground here is an 8-bit, 128-cell copy of
        // the mesh, so without the offset the water still has some opacity
        // where it actually meets the terrain, and that reads as a hard cut.
        // Both measured against the relief, so a taller landform does not
        // turn every basin into open water.
        float E = max(uElevation, 0.001);
        float shore = smoothstep(0.01 * E, 0.08 * E, depth);
        float deep = smoothstep(0.02 * E, 0.33 * E, depth);

        // A slow, broad tilt. Small on purpose: it is what separates this
        // surface from the faceted ground, not a wave.
        vec2 p = vWorldPos.xz;
        float e = 0.6;
        float s0 = swell(p);
        vec2 grad = vec2(swell(p + vec2(e, 0.0)) - s0, swell(p + vec2(0.0, e)) - s0) / e;
        vec3 nrm = normalize(vec3(-grad.x * 0.9, 1.0, -grad.y * 0.9));

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float facing = clamp(dot(nrm, viewDir), 0.0, 1.0);
        float fres = 0.03 + 0.97 * pow(1.0 - facing, 5.0);

        // The sky it reflects: the same ramp the backdrop dome draws.
        vec3 r = reflect(-viewDir, nrm);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.02, 0.5, r.y));
        sky += uHorizon * 0.35 * (1.0 - smoothstep(0.0, 0.12, abs(r.y)));

        vec3 body = mix(uShallow, uDeepWater, deep);
        vec3 col = mix(body, sky, fres);

        // One broad, dim glint. Soft enough to read as a sheen on the far
        // water, not as a sun.
        vec3 halfDir = normalize(uLightDir + viewDir);
        float glint = pow(max(dot(nrm, halfDir), 0.0), 90.0);
        col += uGlint * glint * 0.3;

        // The same reflected-light field the ground receives, faintly on the
        // surface too, so the light below and the sheen above move together.
        float light = reflectedLight(p, uTime) * uLight;
        col += uGlint * light * 0.12;

        // A veil over the ground rather than a sheet hiding it: even the
        // deepest basin lets the terrain's form read through, so the terrain
        // stays the subject and the water reads as something pooled in it.
        float alpha = mix(0.14, 0.46, deep) * uClarity;
        alpha = shore * bounds * clamp(alpha + fres * 0.4 + glint * 0.2 + light * 0.06, 0.0, 0.8);
        // The Water surface control runs the whole way to nothing, so the
        // ground light can be judged without the veil over it.
        alpha *= uWater;

        gl_FragColor = vec4(col, alpha);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The water in a stream's channel: a shallow translucent body, level across
 * its width (lib/streams.js shapes it). It reads the way the basin water
 * does — by what it reflects and by how much ground shows through it — not
 * by drawn edges:
 *
 *   - the banks rise through it, so the depth buffer draws the shoreline,
 *     and it thins to nothing toward that shoreline by its real depth
 *   - its colour is the basin water's, mixed with the sky it reflects,
 *     which is broad and slow across the whole width
 *   - the ripples are in metres, large and soft, drifting downstream —
 *     faster where the ground is steep
 *
 * It rides the ground exactly as the terrain does — sediment lift and the
 * Dormant/Membrane breathing — so it never parts from its bed.
 */
function createStreamWaterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSediment: { value: null },
        uFieldSize: { value: FIELD_SIZE },
        uSedScale: { value: SED_DISPLAY },
        uSedLift: { value: 1 },
        uTime: { value: 0 },
        uMode: { value: 0 },
        uPulse: { value: 0 },
        uMembrane: { value: 0 },
        // The basin water's own palette, so stream and basin are one water.
        // A paler horizon made the grazing reflection read as mist.
        uShallow: hexUniform('#262B5C'),
        uHorizon: hexUniform('#4E5288'),
        uZenith: hexUniform('#12153A'),
        uGlint: hexUniform('#D8D3F2'),
        uLightDir: { value: new THREE.Vector3(-0.6, 0.42, -0.55).normalize() },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec4 aFlow;
      uniform sampler2D uSediment;
      uniform float uFieldSize;
      uniform float uSedScale;
      uniform float uSedLift;
      uniform float uTime;
      uniform float uMode;
      uniform float uPulse;
      uniform float uMembrane;
      varying vec2 vUv;
      varying vec4 vFlow;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vFlow = aFlow;
        vec2 fuv = position.xz / uFieldSize + 0.5;
        float sed = texture2D(uSediment, fuv).r * uSedScale;
        // The terrain's own movements, so the water stays in its bed.
        float breathe = 0.0;
        if (uMode > 1.5 && uMode < 2.5) {
          breathe = sin(uTime * 0.35 + position.x * 0.18 + position.z * 0.14) * uPulse * sed * 0.6;
        } else if (uMode > 2.5) {
          breathe = sin(uTime * 0.22 + position.x * 0.31) * cos(uTime * 0.17 + position.z * 0.27) * uMembrane * 0.09;
        }
        vec3 p = position;
        p.y += sed * uSedLift + breathe;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uGlint;
      uniform vec3 uLightDir;
      varying vec2 vUv;
      varying vec4 vFlow;
      varying vec3 vWorldPos;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        float t = uTime * vFlow.y;
        // Broad, soft ripples in metres, drifting downstream.
        vec2 q = vec2(vUv.x * 1.4, vUv.y * 0.9 - t * 0.6);
        float a = valueNoise(q);
        float b = valueNoise(q * 2.1 + vec2(4.3, -t * 0.4));
        vec3 nrm = normalize(vec3((a - 0.5) * 0.22 + (b - 0.5) * 0.08, 1.0, (b - 0.5) * 0.12));

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float facing = clamp(dot(nrm, viewDir), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - facing, 4.0);
        vec3 r = reflect(-viewDir, nrm);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.02, 0.5, r.y));
        vec3 col = mix(uShallow, sky, 0.3 + 0.6 * fres);
        // Movement across the whole width: soft broad bands of reflected
        // light where the ripples tilt toward the sky, drifting downstream;
        // one narrow, dim glint.
        float sheen = smoothstep(0.55, 0.9, a * 0.7 + b * 0.3);
        float glint = pow(max(dot(nrm, normalize(uLightDir + viewDir)), 0.0), 80.0);
        col += uHorizon * sheen * 0.35 + uGlint * glint * 0.25;

        // Depth here (from the vertex), so it thins toward its shore rather
        // than ending at a line, and vanishes where it would hang over a
        // drop it cannot be in.
        float depth = vFlow.z;
        float shore = smoothstep(0.0, 0.012, depth);
        float overhang = 1.0 - smoothstep(0.1, 0.25, depth);
        float side = 1.0 - smoothstep(0.85, 1.0, abs(vFlow.w));
        float alpha = vFlow.x * shore * overhang * side * (0.62 + 0.25 * fres + sheen * 0.1 + glint * 0.2);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.8));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

/**
 * The sediment field: base terrain from the height field, a tidal plane, and
 * the running simulation written into a texture the terrain shader reads.
 */
export default function Terrain({
  field,
  params,
  sim,
  simParams,
  running,
  wireframe,
  shader,
  streams,
}) {
  const { resolution, elevation, waterLevel } = params

  const material = useMemo(() => createTerrainMaterial(), [])
  const waterMaterial = useMemo(() => createWaterMaterial(), [])
  const streamWaterMaterial = useMemo(() => createStreamWaterMaterial(), [])

  // The water lying in each stream's channel (lib/streams.js builds it).
  const streamGeometry = useMemo(() => {
    const w = streams?.water
    if (!w) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(w.position, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(w.uv, 2))
    geo.setAttribute('aFlow', new THREE.BufferAttribute(w.flow, 4))
    geo.setIndex(w.index)
    geo.computeBoundingSphere()
    return geo
  }, [streams])
  useEffect(() => () => streamGeometry?.dispose(), [streamGeometry])

  // One texture carries the simulation to the GPU: R = sediment, G = activity,
  // B = base ground height (so the water surface knows how deep it is).
  const { texture, pixels } = useMemo(() => {
    const pixels = new Uint8Array(SIM_RES * SIM_RES * 4)
    const texture = new THREE.DataTexture(pixels, SIM_RES, SIM_RES, THREE.RGBAFormat)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return { texture, pixels }
  }, [])

  material.uniforms.uSediment.value = texture
  waterMaterial.uniforms.uSim.value = texture

  // The streams' ground material, uploaded when the world supplies a new one.
  const streamTexture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(STREAM_RES * STREAM_RES * 4), STREAM_RES, STREAM_RES, THREE.RGBAFormat)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.needsUpdate = true
    return t
  }, [])
  const streamUploaded = useRef(undefined)

  const geometry = useMemo(() => {
    const grid = buildHeightGrid(field, resolution)
    const geo = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, resolution, resolution)
    geo.rotateX(-Math.PI / 2)

    // After the rotation, vertex k = j * (res + 1) + i sits at u = i / res,
    // v = j / res — the same order buildHeightGrid() writes.
    const position = geo.attributes.position
    const heights = new Float32Array(position.count)
    for (let k = 0; k < position.count; k++) {
      const h = Number.isFinite(grid[k]) ? grid[k] : 0.5
      heights[k] = h
      // Centre the field on the origin so amplitude does not slide the terrain.
      position.setY(k, (h - 0.5) * elevation)
    }
    geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1))
    position.needsUpdate = true
    // Smooth normals, for the membrane and for where water light lands. The
    // other modes keep deriving faceted normals per fragment.
    geo.computeVertexNormals()

    // Rank this landform's slopes once, so Geological can put strata on its
    // steeper faces whatever the terrain: median exposure among the default
    // settings is ~0.025, on a rough landform ~0.16.
    const ny = geo.attributes.normal
    const exposure = new Float32Array(ny.count)
    for (let k = 0; k < ny.count; k++) exposure[k] = 1 - ny.getY(k)
    exposure.sort()
    const lo = exposure[Math.floor(exposure.length * 0.45)]
    const hi = exposure[Math.floor(exposure.length * 0.85)]
    geo.userData.exposureRange = [lo, Math.max(hi, lo + 0.01)]
    // Positions changed after construction, so the culling volumes have to be
    // rebuilt or the mesh can be culled at the wrong moment.
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }, [field, resolution, elevation])

  const waterY = (waterLevel - 0.5) * elevation
  const waterRef = useRef(null)
  const accumulator = useRef(0)
  // Which simulation, at which version, is in the texture. The Scatter view
  // swaps in a different (history) simulation, whose version number alone
  // could match the live one's and leave the old texture in place.
  const uploaded = useRef({ sim: null, version: -1 })
  const liveGeometry = useRef(null)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    // Uniforms are pushed here rather than from an effect: one place, always
    // after commit, and no lifecycle to get wrong.
    //
    // Written through a guard because a hot reload can leave the previous
    // material instance in place — it was built by a useMemo that never
    // re-runs — while this code already expects uniforms the old shader never
    // declared. Assigning straight through would throw once per frame and take
    // the whole render loop down with it, which looks like a frozen canvas
    // rather than like an error.
    const uniforms = material.uniforms
    const set = (name, value) => {
      const uniform = uniforms[name]
      if (uniform) uniform.value = value
    }

    set('uSediment', texture)
    set('uWaterLevel', waterLevel)
    set('uSedLift', elevation * SEDIMENT_LIFT)
    set('uElevation', elevation)
    const [exposureLo, exposureHi] = geometry.userData.exposureRange ?? [0.03, 0.1]
    set('uExposureLo', exposureLo)
    set('uExposureHi', exposureHi)
    material.wireframe = wireframe

    // No shader descriptor means the Field view, which is mode 0 and behaves
    // exactly as it did before the study existed.
    set('uTime', t)
    set('uMode', shader ? shader.mode : 0)
    const streamMaterial = streams?.material
    if (streamMaterial !== streamUploaded.current) {
      streamUploaded.current = streamMaterial
      if (streamMaterial && streamMaterial.res === streamTexture.image.width) streamTexture.image.data.set(streamMaterial.data)
      else streamTexture.image.data.fill(0)
      streamTexture.needsUpdate = true
    }
    set('uStream', streamTexture)
    // Everything moves, nothing moves fast: a ~50s tide. The caustic band
    // follows it, so light on the ground and the surface above stay together.
    const tideY = waterY + Math.sin(t * 0.125) * elevation * 0.012
    set('uWaterY', tideY)
    set('uCaustics', shader ? shader.caustics : 0)

    // One water for every tab: the depth-aware veil pooled in the basins.
    // Clarity follows the reading of the ground: the Field view's plain ramp
    // takes a little more body; Membrane, pale everywhere, needs the most to
    // stay a separate surface. Dormant's was 0.6 — too clear, and its basins
    // read as empty pits.
    const water = waterMaterial.uniforms
    const setWater = (name, value) => {
      if (water[name]) water[name].value = value
    }
    const mode = shader ? shader.mode : 0
    setWater('uSim', texture)
    setWater('uTime', t)
    setWater('uWater', shader ? shader.water : 0.85)
    setWater('uLight', shader ? shader.caustics : 0)
    setWater('uElevation', elevation)
    setWater('uSedLift', elevation * SEDIMENT_LIFT)
    setWater('uClarity', mode === 0 ? 1.15 : mode === 2 ? 0.9 : mode === 3 ? 1.3 : 1)

    // The streams' water rides the same ground: sediment lift and breathing.
    const sw = streamWaterMaterial.uniforms
    sw.uSediment.value = texture
    sw.uTime.value = t
    sw.uSedLift.value = elevation * SEDIMENT_LIFT
    sw.uMode.value = mode
    sw.uPulse.value = shader ? shader.pulse : 0
    sw.uMembrane.value = shader ? shader.membrane : 0

    if (shader) {
      set('uHeightInfluence', shader.heightInfluence)
      set('uStrata', shader.strata)
      set('uActivityInfluence', shader.activity)
      set('uRelief', shader.relief ?? 0)
      set('uPulse', shader.pulse)
      set('uFresnel', shader.fresnel)
      set('uMembrane', shader.membrane)
    }

    // Release the previous grid once a new resolution has taken over.
    if (liveGeometry.current && liveGeometry.current !== geometry) {
      liveGeometry.current.dispose()
    }
    liveGeometry.current = geometry

    if (waterRef.current) waterRef.current.position.y = tideY

    if (running) {
      accumulator.current += Math.min(delta, 0.12)
      let steps = 0
      while (accumulator.current >= SIM_STEP && steps < MAX_STEPS_PER_FRAME) {
        sim.step(SIM_STEP, { ...simParams, waterLevel })
        accumulator.current -= SIM_STEP
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator.current = 0
    }

    if (sim !== uploaded.current.sim || sim.version !== uploaded.current.version) {
      uploaded.current = { sim, version: sim.version }
      const { sediment, activity, height } = sim
      for (let i = 0; i < sediment.length; i++) {
        const p = i * 4
        pixels[p] = Math.min(255, (sediment[i] / SED_DISPLAY) * 255)
        pixels[p + 1] = Math.min(255, activity[i] * 255)
        // Height over -0.5…1.5 (see the water shader), so relief survives.
        pixels[p + 2] = Math.min(255, Math.max(0, ((height[i] + 0.5) / 2) * 255))
        pixels[p + 3] = 255
      }
      texture.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh geometry={geometry} material={material} />

      {/* One water for every tab: bounded to the terrain, pooled in its
          basins. (The Field view used to have its own plane, seven times
          the field's size; the tabs then showed different worlds.) */}
      <mesh
        key="water"
        position={[0, waterY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        ref={waterRef}
        material={waterMaterial}
      >
        <planeGeometry args={[FIELD_SIZE, FIELD_SIZE, 1, 1]} />
      </mesh>

      {streamGeometry && <mesh geometry={streamGeometry} material={streamWaterMaterial} renderOrder={1} />}
    </group>
  )
}
