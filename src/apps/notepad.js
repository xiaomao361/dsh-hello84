import { getPrefs } from '../prefs.js'
import { sound } from '../sound.js'

const STORAGE_KEY = 'notepad.v1'
const MAX_PAGES = 16

function defaultState() {
  return {
    index: 0,
    pages: [
      'Hello \'84 翻页便签\n— 跨会话暂存草稿、trace_id 或提示词片段\n— 点击左下角折角翻页，或一键注入外部 DSH 输入框',
      '',
      '',
      '',
    ],
  }
}

export function createNotePadStore(win) {
  const prefs = getPrefs(win)
  const listeners = new Set()

  function load() {
    const raw = prefs.get(STORAGE_KEY)
    if (raw && Array.isArray(raw.pages) && raw.pages.length) {
      const pages = raw.pages.slice(0, MAX_PAGES).map(p => String(p ?? ''))
      const index = Math.max(0, Math.min(pages.length - 1, Number(raw.index) || 0))
      return { index, pages }
    }
    return defaultState()
  }

  let state = load()

  function save() {
    prefs.set(STORAGE_KEY, state)
    const snap = getSnapshot()
    for (const fn of listeners) {
      try { fn(snap) } catch {}
    }
  }

  function getSnapshot() {
    return { index: state.index, pages: [...state.pages] }
  }

  function setPageText(text) {
    state.pages[state.index] = String(text ?? '')
    save()
  }

  function goTo(idx) {
    state.index = ((idx % state.pages.length) + state.pages.length) % state.pages.length
    save()
  }

  function nextPage() {
    goTo(state.index + 1)
  }

  function prevPage() {
    goTo(state.index - 1)
  }

  function addPage(initialText = '') {
    if (state.pages.length >= MAX_PAGES) {
      state.index = state.pages.length - 1
      if (initialText) state.pages[state.index] = (state.pages[state.index] ? state.pages[state.index] + '\n\n' : '') + initialText
      save()
      return state.index
    }
    state.pages.push(String(initialText ?? ''))
    state.index = state.pages.length - 1
    save()
    return state.index
  }

  function appendNote(title, content) {
    const entry = title ? `[${title}]\n${content}` : String(content ?? '')
    // Prefer an empty page if available, otherwise add a page
    const emptyIdx = state.pages.findIndex(p => !p.trim())
    if (emptyIdx !== -1) {
      state.index = emptyIdx
      state.pages[emptyIdx] = entry
      save()
      return emptyIdx
    }
    return addPage(entry)
  }

  return {
    getSnapshot,
    setPageText,
    goTo,
    nextPage,
    prevPage,
    addPage,
    appendNote,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export function renderNotePad(doc, { win, bridge, noteStore, notify }) {
  const root = doc.createElement('div')
  root.className = 'h84-notepad'

  const toolbar = doc.createElement('div')
  toolbar.className = 'h84-app-bar'
  toolbar.innerHTML = `
    <button type="button" class="h84-btn" data-act="inject" title="将当前页写入外部 DSH 输入框">注入外部输入框</button>
    <button type="button" class="h84-btn" data-act="copy">复制</button>
    <button type="button" class="h84-btn" data-act="add">+ 新页</button>
    <button type="button" class="h84-btn" data-act="clear">清空</button>
  `

  const area = doc.createElement('textarea')
  area.className = 'h84-notepad-area'
  area.placeholder = '在此写下便签…'
  area.setAttribute('aria-label', '便签正文')

  const footer = doc.createElement('div')
  footer.className = 'h84-notepad-footer'
  footer.innerHTML = `
    <button type="button" class="h84-dogear" data-act="next" title="点击折角翻到下一页" aria-label="翻到下一页"></button>
    <div class="h84-notepad-nav">
      <button type="button" class="h84-btn-sm" data-act="prev">◀</button>
      <span class="h84-notepad-page">1 / 4</span>
      <button type="button" class="h84-btn-sm" data-act="next">▶</button>
    </div>
  `

  root.append(toolbar, area, footer)

  const pageLabel = footer.querySelector('.h84-notepad-page')

  function sync() {
    const snap = noteStore.getSnapshot()
    if (area.value !== snap.pages[snap.index]) {
      area.value = snap.pages[snap.index]
    }
    pageLabel.textContent = `Page ${snap.index + 1} / ${snap.pages.length}`
  }

  const unsub = noteStore.subscribe(sync)

  area.addEventListener('input', () => {
    noteStore.setPageText(area.value)
  })

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    sound.click(win)
    if (act === 'next') noteStore.nextPage()
    else if (act === 'prev') noteStore.prevPage()
    else if (act === 'add') noteStore.addPage('')
    else if (act === 'clear') noteStore.setPageText('')
    else if (act === 'copy') {
      const text = area.value.trim()
      if (!text) return notify?.('当前便签为空')
      try {
        await win.navigator.clipboard.writeText(text)
        notify?.('便签已复制到剪贴板')
      } catch {
        notify?.('剪贴板不可用')
      }
    } else if (act === 'inject') {
      const text = area.value.trim()
      if (!text) return notify?.('当前便签为空')
      const ok = bridge.fillHostDraft(text, { replace: false })
      notify?.(ok ? '已注入外部 DSH 输入框' : '未找到外部 DSH 输入框')
    }
  })

  sync()
  return { element: root, destroy: unsub }
}
