import { useCallback, useEffect, useState } from 'react'
import useAuth from '../hooks/useAuth'
import { signInWithGoogle, signOutOfGoogle } from '../firebase/auth'
import { deleteConfig, listConfigs, saveConfig } from '../firebase/configs'

const formatWhen = (value) => {
  const date = value?.toDate?.()
  if (!date) return 'just now'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const message = (error) => {
  const code = error?.code ?? ''
  if (code === 'auth/popup-blocked') return 'The browser blocked the sign-in popup.'
  if (code === 'auth/popup-closed-by-user') return 'Sign-in cancelled.'
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorised in Firebase Auth.'
  if (code === 'permission-denied') return 'Denied by security rules — check they are deployed.'
  return error?.message ?? 'Something went wrong.'
}

/**
 * Saved configurations, per signed-in user.
 *
 * Collapsed to a single word by default: the world comes first, and this is a
 * dev tool that opens when it is asked for. It owns its own Firebase state so
 * the rest of the app stays procedural — it asks for the current state when
 * saving, and hands a state back when loading.
 */
export default function LibraryPanel({ getState, captureThumbnail, onLoad }) {
  const { user, ready, configured } = useAuth()
  const [open, setOpen] = useState(false)
  const [configs, setConfigs] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async (uid) => {
    try {
      setConfigs(await listConfigs(uid))
      setError(null)
    } catch (failure) {
      setError(message(failure))
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setConfigs([])
      return
    }
    refresh(user.uid)
  }, [user, refresh])

  const run = async (work) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () =>
    run(async () => {
      const thumbnail = captureThumbnail?.() ?? null
      await saveConfig({ uid: user.uid, name, state: getState(), thumbnail })
      setName('')
      await refresh(user.uid)
    })

  const handleDelete = (config) =>
    run(async () => {
      await deleteConfig(user.uid, config)
      await refresh(user.uid)
    })

  return (
    <div
      className="library"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`library-toggle${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Library
      </button>

      {open && (
        <aside className="library-panel" aria-label="Saved configurations">
          {!configured && (
            <p className="panel-note">
              Firebase is not configured. Copy <code>.env.example</code> to{' '}
              <code>.env</code> and follow <code>docs/tutorials/firebase.md</code>.
            </p>
          )}

          {configured && !ready && <p className="panel-note">Checking sign-in…</p>}

          {configured && ready && !user && (
            <>
              <p className="panel-note">Sign in to save the current state.</p>
              <div className="button-row">
                <button
                  type="button"
                  className="control-button"
                  onClick={() => run(signInWithGoogle)}
                  disabled={busy}
                >
                  Sign in with Google
                </button>
              </div>
            </>
          )}

          {configured && ready && user && (
            <>
              <p className="library-account">
                <span className="library-email" title={user.email ?? ''}>
                  {user.email ?? user.displayName ?? 'signed in'}
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => run(signOutOfGoogle)}
                >
                  sign out
                </button>
              </p>

              <div className="save-row">
                <input
                  className="text-input"
                  type="text"
                  value={name}
                  placeholder="name this state"
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) handleSave()
                  }}
                />
                <button
                  type="button"
                  className="control-button"
                  onClick={handleSave}
                  disabled={busy}
                >
                  Save
                </button>
              </div>

              {configs.length === 0 && !busy && (
                <p className="panel-note">Nothing saved yet.</p>
              )}

              <ul className="config-list">
                {configs.map((config) => (
                  <li key={config.id} className="config-row">
                    <button
                      type="button"
                      className="config-open"
                      onClick={() => onLoad(config)}
                      title="Load this configuration"
                    >
                      {config.thumbnailUrl || config.thumbnailInline ? (
                        <img
                          className="config-thumb"
                          src={config.thumbnailUrl ?? config.thumbnailInline}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="config-thumb is-empty" />
                      )}
                      <span className="config-meta">
                        <span className="config-name">{config.name}</span>
                        <span className="config-when">
                          {config.view} · {formatWhen(config.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="link-button config-delete"
                      onClick={() => handleDelete(config)}
                      aria-label={`Delete ${config.name}`}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && <p className="panel-error">{error}</p>}
        </aside>
      )}
    </div>
  )
}
