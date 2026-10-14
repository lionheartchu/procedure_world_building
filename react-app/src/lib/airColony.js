import * as THREE from 'three'
import { COLONY_AIR } from './air'

/**
 * The uniforms every air shader reads for the colonies (phase 3), and how to
 * fill them from colonyAirData (lib/air.js).
 */
export function colonyAirUniforms() {
  return {
    uColonyAir: { value: 0 },
    uColonyRise: { value: 1 },
    uObsA: { value: Array.from({ length: COLONY_AIR.maxObstacles }, () => new THREE.Vector4()) },
    uObsB: { value: Array.from({ length: COLONY_AIR.maxObstacles }, () => new THREE.Vector4(1, 0, 1, 1)) },
    uObsS: { value: new Array(COLONY_AIR.maxObstacles).fill(0) },
    uObsCount: { value: 0 },
    uColonies: { value: Array.from({ length: COLONY_AIR.maxColonies }, () => new THREE.Vector4()) },
    uColonyCount: { value: 0 },
  }
}

export function setColonyAir(u, data, strength) {
  const obstacles = data?.obstacles ?? []
  const colonies = data?.colonies ?? []
  u.uColonyAir.value = obstacles.length ? strength : 0
  u.uObsCount.value = obstacles.length
  obstacles.forEach((o, i) => {
    u.uObsA.value[i].set(o.c[0], o.c[1], o.c[2], o.h)
    u.uObsB.value[i].set(o.b[0], o.b[1], o.la, o.lc)
    u.uObsS.value[i] = o.s
  })
  u.uColonyCount.value = colonies.length
  colonies.forEach((c, i) => u.uColonies.value[i].set(c[0], c[1], c[2], c[3]))
}
