const PREFIX = 'dsh-hello84.'
const cache = new WeakMap()

export function createPrefs(win) {
  const memory = new Map()
  const listeners = new Set()

  function storage() {
    try {
      return win?.localStorage ?? null
    } catch {
      return null
    }
  }

  function get(key, fallback = undefined) {
    const full = PREFIX + key
    const store = storage()
    if (store) {
      try {
        const raw = store.getItem(full)
        if (raw !== null) return JSON.parse(raw)
      } catch {
        // ignore parse/storage errors
      }
    }
    return memory.has(full) ? memory.get(full) : fallback
  }

  function set(key, value) {
    const full = PREFIX + key
    memory.set(full, value)
    let persisted = false
    const store = storage()
    if (store) {
      try {
        store.setItem(full, JSON.stringify(value))
        persisted = true
      } catch {
        persisted = false
      }
    }
    for (const fn of listeners) {
      try { fn(key, value) } catch {}
    }
    return persisted
  }

  function remove(key) {
    const full = PREFIX + key
    memory.delete(full)
    const store = storage()
    if (store) {
      try {
        store.removeItem(full)
        return true
      } catch {
        return false
      }
    }
    return true
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { get, set, remove, subscribe }
}

export function getPrefs(win) {
  if (!win || typeof win !== 'object') return createPrefs(null)
  if (!cache.has(win)) cache.set(win, createPrefs(win))
  return cache.get(win)
}
