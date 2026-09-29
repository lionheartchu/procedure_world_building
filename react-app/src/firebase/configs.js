/**
 * Saved Residual Ecology configurations.
 *
 *     users/{uid}/configs/{configId}          Firestore document
 *     users/{uid}/configs/{configId}.jpg      Storage thumbnail
 *
 * A configuration is the whole procedural state — which view is open, the Field
 * parameters, the simulation parameters, and the Volume parameters including
 * the meshing method — so loading one restores exactly what was on screen.
 *
 * Security rules keep each uid inside its own subtree; these functions never
 * take a uid from anywhere except the signed-in user.
 *
 * Cloud Storage needs the Blaze plan, which a school Google Cloud organisation
 * may not allow. When the upload fails the thumbnail is kept inline in the
 * Firestore document instead — it is only a few tens of kilobytes against a
 * 1 MiB document limit. The Storage path stays first in line, so upgrading the
 * project later starts using it again with no code change.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadString,
} from 'firebase/storage'
import { db, storage } from './app'

const MAX_CONFIGS = 30

/** Characters of data URL we are willing to keep inside a Firestore document. */
const MAX_INLINE_THUMBNAIL = 400_000

/** Flipped off after the first failed upload, so one save pays the cost once. */
let storageAvailable = true

const configsCollection = (uid) => collection(db, 'users', uid, 'configs')

/** Everything that has to be captured to reproduce the current screen. */
export function serializeState({ view, params, simParams, volumeParams }) {
  return {
    view,
    params: { ...params },
    simParams: { ...simParams },
    volumeParams: { ...volumeParams },
  }
}

/**
 * Save a configuration.
 *
 * The document is written first, with the thumbnail inline, so saving never
 * waits on Cloud Storage — a project on the free plan has no bucket, and the
 * SDK spends minutes retrying one that is not there before it gives up.
 */
export async function saveConfig({ uid, name, state, thumbnail }) {
  const reference = doc(configsCollection(uid))
  const inline =
    thumbnail && thumbnail.length <= MAX_INLINE_THUMBNAIL ? thumbnail : null

  await setDoc(reference, {
    name: name.trim() || 'Untitled',
    ...serializeState(state),
    thumbnailUrl: null,
    thumbnailPath: null,
    thumbnailInline: inline,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // Then, in the background, move the thumbnail into Storage if this project
  // has it. Deliberately not awaited: the save is already done either way.
  if (thumbnail && storageAvailable && storage) {
    promoteThumbnail(uid, reference.id, thumbnail).catch(() => {})
  }

  return reference.id
}

/** Best-effort upgrade of an inline thumbnail to a Cloud Storage object. */
async function promoteThumbnail(uid, configId, thumbnail) {
  try {
    const thumbnailPath = `users/${uid}/configs/${configId}.jpg`
    const object = storageRef(storage, thumbnailPath)
    await uploadString(object, thumbnail, 'data_url', {
      contentType: 'image/jpeg',
    })
    await updateDoc(doc(db, 'users', uid, 'configs', configId), {
      thumbnailUrl: await getDownloadURL(object),
      thumbnailPath,
      thumbnailInline: null,
    })
  } catch (error) {
    // Almost always "this project has no Storage bucket". Stop trying for the
    // rest of the session; the inline thumbnail already saved is fine.
    storageAvailable = false
    console.info(
      'Cloud Storage unavailable — thumbnails stay in Firestore.',
      error?.code ?? error,
    )
  }
}

/** The user's configurations, newest first. */
export async function listConfigs(uid) {
  const snapshot = await getDocs(
    query(configsCollection(uid), orderBy('updatedAt', 'desc'), limit(MAX_CONFIGS)),
  )
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
}

/** Delete a configuration and its thumbnail. A missing file is not an error. */
export async function deleteConfig(uid, config) {
  await deleteDoc(doc(db, 'users', uid, 'configs', config.id))
  if (config.thumbnailPath) {
    try {
      await deleteObject(storageRef(storage, config.thumbnailPath))
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') {
        console.warn('Thumbnail delete failed.', error)
      }
    }
  }
}
