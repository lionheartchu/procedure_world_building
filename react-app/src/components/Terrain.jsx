import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildHeightGrid } from '../lib/field'
import { SED_DISPLAY, SIM_RES } from '../lib/sediment'
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
        uActivityInfluence: { value: 0.7 },
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
      uniform float uActivityInfluence;
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
          // Bedding is about twelve beds across the whole relief — scaled to
          // the elevation, so it holds up on any landform — each with its own
          // value, split by a thin darker parting. The beds are warped by a
          // slow noise so they read as deposited layers rather than as
          // contour lines of the height, and they show most on steep faces,
          // where real bedding is exposed. The previous version drew bands at
          // a fixed 0.11 world units and darkened them by at most ~8%, which
          // at default strength was simply not visible.
          float E = max(uElevation, 0.001);
          float h = (vHeight - uWaterLevel) * uHeightInfluence;
          float exposure = 1.0 - clamp(n.y, 0.0, 1.0);

          float warp = (valueNoise(vWorldPos.xz * 0.12) - 0.5) * 0.9
                     + (valueNoise(vWorldPos.xz * 0.37 + 4.0) - 0.5) * 0.3;
          float bedCoord = (vWorldPos.y / E + 0.5) * 12.0 + warp;
          float bedTone = 0.76 + 0.36 * hash21(vec2(floor(bedCoord), 3.7));
          float bedEdge = min(fract(bedCoord), 1.0 - fract(bedCoord));
          float aa = fwidth(bedCoord);
          float parting = (1.0 - smoothstep(0.0, 0.05 + aa * 1.2, bedEdge))
                        * (1.0 - smoothstep(0.15, 0.45, aa));
          float show = uStrata * (0.3 + 0.7 * smoothstep(0.05, 0.55, exposure));

          vec3 base = rampColor(h);
          base *= mix(1.0, bedTone, show);
          base *= 1.0 - parting * show * 0.5;

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
          float residueMask = smoothstep(0.12, 0.62, sed);
          vec3 residue = mix(dormant, uSedimentTint * 0.85, residueMask * uActivityInfluence);
          lit = residue * (ambient + uLightColor * wrap * 0.7);

          // Slow and spatial, so it travels across the ground rather than
          // flashing the whole scene at once.
          float pulse = 0.65 + 0.35 * sin(uTime * 0.4 + vWorldPos.x * 0.11 + vWorldPos.z * 0.08);
          emit += uSedimentTint * residueMask * residueMask * uPulse * 0.18 * pulse;
          emit += uMint * pow(act, 1.6) * uPulse * 0.9 * pulse;

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
        if (uCaustics > 0.0 && uMode > 0.5) {
          float dn = (uWaterY - vWorldPos.y) / max(uElevation, 0.001);
          float reach = dn >= 0.0 ? exp(-dn * 3.5) : 1.0 - smoothstep(0.0, 0.06, -dn);
          float receive = 0.35 + 0.65 * clamp(ns.y, 0.0, 1.0);
          // Dormant keeps it lower so it never competes with residue;
          // Membrane is already pale, so the same light reads much stronger.
          float modeGain = uMode > 2.5 ? 0.55 : uMode > 1.5 ? 0.45 : 1.0;
          float c = reflectedLight(vWorldPos.xz, uTime) * reach * receive * uCaustics * modeGain;
          lit += (lit * 0.85 + uCaustic * 0.07) * c;
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
        float ground = (sim.b - 0.5) * uElevation + sim.r * uSedScale * uSedLift;
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
}) {
  const { resolution, elevation, waterLevel } = params

  const material = useMemo(() => createTerrainMaterial(), [])
  const waterMaterial = useMemo(() => createWaterMaterial(), [])

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
    // Positions changed after construction, so the culling volumes have to be
    // rebuilt or the mesh can be culled at the wrong moment.
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }, [field, resolution, elevation])

  const waterY = (waterLevel - 0.5) * elevation
  const waterRef = useRef(null)
  const accumulator = useRef(0)
  const uploaded = useRef(-1)
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
    material.wireframe = wireframe

    // No shader descriptor means the Field view, which is mode 0 and behaves
    // exactly as it did before the study existed.
    set('uTime', t)
    set('uMode', shader ? shader.mode : 0)
    // Everything moves, nothing moves fast: a ~50s tide. The caustic band
    // follows it, so light on the ground and the surface above stay together.
    const tideY = waterY + Math.sin(t * 0.125) * elevation * 0.012
    set('uWaterY', tideY)
    set('uCaustics', shader ? shader.caustics : 0)
    if (shader) {
      set('uHeightInfluence', shader.heightInfluence)
      set('uStrata', shader.strata)
      set('uActivityInfluence', shader.activity)
      set('uPulse', shader.pulse)
      set('uFresnel', shader.fresnel)
      set('uMembrane', shader.membrane)
      const water = waterMaterial.uniforms
      const setWater = (name, value) => {
        if (water[name]) water[name].value = value
      }
      setWater('uSim', texture)
      setWater('uTime', t)
      setWater('uWater', shader.water)
      setWater('uLight', shader.caustics)
      setWater('uElevation', elevation)
      setWater('uSedLift', elevation * SEDIMENT_LIFT)
      // Dormant's record mostly settles in the basins, i.e. under the water,
      // so the surface is kept clearer there rather than hiding it. Membrane
      // is pale everywhere, so its water needs more body to stay a separate
      // surface rather than a tint on the same skin.
      setWater('uClarity', shader.mode === 2 ? 0.6 : shader.mode === 3 ? 1.3 : 1)
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

    if (sim.version !== uploaded.current) {
      uploaded.current = sim.version
      const { sediment, activity, height } = sim
      for (let i = 0; i < sediment.length; i++) {
        const p = i * 4
        pixels[p] = Math.min(255, (sediment[i] / SED_DISPLAY) * 255)
        pixels[p + 1] = Math.min(255, activity[i] * 255)
        pixels[p + 2] = Math.min(255, Math.max(0, height[i] * 255))
        pixels[p + 3] = 255
      }
      texture.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh geometry={geometry} material={material} />

      {/* The Field view keeps its original water; the shader study gets the
          shared shaded surface, bounded to the terrain.

          The keys are load-bearing. Without them React reuses the same
          <mesh> across the switch, and react-three-fiber "resets" the removed
          material prop to a blank MeshBasicMaterial — white, unlit — which is
          what painted the Field view pale after Shaders → Field. Keyed, each
          water is its own object and is unmounted cleanly. */}
      {shader ? (
        <mesh
          key="study-water"
          position={[0, waterY, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          ref={waterRef}
          material={waterMaterial}
        >
          <planeGeometry args={[FIELD_SIZE, FIELD_SIZE, 1, 1]} />
        </mesh>
      ) : (
      <mesh
        key="field-water"
        position={[0, waterY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        ref={waterRef}
      >
        <planeGeometry args={[FIELD_SIZE * 7, FIELD_SIZE * 7]} />
        <meshStandardMaterial
          color="#2A3060"
          emissive="#565C96"
          emissiveIntensity={0.32}
          roughness={0.45}
          metalness={0.12}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      )}
    </group>
  )
}
