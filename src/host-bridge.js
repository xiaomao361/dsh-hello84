// Unified host bridge for DeepSeek Harness (DSH) + offline preview/test mocks.

export function sanitizePaths(text) {
  if (!text) return ''
  return String(text)
    .replace(/\/Users\/[^/\s"'`]+/g, '/Users/<user>')
    .replace(/\/home\/[^/\s"'`]+/g, '/home/<user>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`]+/g, 'C:\\Users\\<user>')
}

export function extractDomMessages(doc) {
  if (!doc) return []
  const content = doc.querySelector('[data-conversation-content]') || doc.querySelector('#thread')
  if (!content) return []
  const rows = []
  const flowNodes = content.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="assistant"]')
  if (flowNodes.length) {
    for (const node of flowNodes) {
      if (node.closest('[hidden], [aria-hidden="true"]') || node.dataset.chatGroupPart === 'process') continue
      const text = (node.textContent || '').trim()
      if (!text) continue
      rows.push({
        role: node.dataset.chatFlowKind === 'assistant' ? 'assistant' : 'user',
        text,
      })
    }
    return rows
  }
  const article = content.matches('article') ? content : content.querySelector('article')
  if (!article) return rows
  for (const el of article.children) {
    const text = (el.textContent || '').trim()
    if (!text) continue
    if (el.matches('.user-message')) {
      rows.push({ role: 'user', text })
    } else if (rows.at(-1)?.role === 'assistant') {
      rows.at(-1).text += '\n\n' + text
    } else {
      rows.push({ role: 'assistant', text })
    }
  }
  return rows
}

function legacyMessageText(blocks) {
  return (blocks || []).map(block => {
    const type = block.kind || block.type
    if (type === 'text' && typeof block.text === 'string') return block.text
    if (type === 'image') return '[图片]'
    if (type === 'file') return '[文件' + (block.attachment?.name ? '：' + block.attachment.name : '') + ']'
    return ''
  }).filter(Boolean).join('\n\n')
}

export function extractLegacyMessages(legacy) {
  if (!Array.isArray(legacy?.nodes)) return null
  const rows = []
  for (const node of legacy.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = legacyMessageText(node.content)
      if (text.trim()) rows.push({ role: 'user', text })
    } else if (node.kind === 'assistant') {
      const text = legacyMessageText(node.blocks)
      if (text.trim()) rows.push({ role: 'assistant', text })
    }
  }
  if (legacy.partial) {
    const exists = legacy.nodes.some(n => n.kind === 'assistant' && n.turn === legacy.partial.turn && n.step === legacy.partial.step)
    if (!exists) {
      const text = legacyMessageText(legacy.partial.blocks)
      if (text.trim()) rows.push({ role: 'assistant', text })
    }
  }
  return rows
}

export function createHostBridge(win, options = {}) {
  const doc = win?.document
  const listeners = new Set()
  const transitionListeners = new Set()

  let state = {
    status: 'idle',
    sessionId: null,
    sessionTitle: '',
    workspaceName: '默认工作区',
    sessions: [],
    ...(options.initialState || {}),
  }

  let latestLegacy = null
  let inputController = null
  let openSessionHandler = options.openSession || null
  let sendMessageHandler = options.sendMessage || null

  function emit() {
    const snap = getSnapshot()
    for (const fn of listeners) {
      try { fn(snap) } catch {}
    }
  }

  function update(patch) {
    const prevStatus = state.status
    const prevSession = state.sessionId
    state = { ...state, ...patch }
    if (patch.status && patch.status !== prevStatus) {
      for (const fn of transitionListeners) {
        try {
          fn(prevStatus, patch.status, {
            sessionId: state.sessionId,
            sessionTitle: state.sessionTitle,
            sameSession: prevSession === state.sessionId,
          })
        } catch {}
      }
    }
    emit()
  }

  function getSnapshot() {
    return {
      ...state,
      sessions: state.sessions.map(s => ({ ...s })),
    }
  }

  function findComposerInput() {
    if (!doc) return null
    return doc.querySelector('[data-composer-input]') || doc.querySelector('textarea#draft') || doc.querySelector('textarea')
  }

  function getHostDraft() {
    if (inputController?.getDraft) {
      const val = inputController.getDraft()
      if (typeof val === 'string') return val
    }
    const el = findComposerInput()
    if (!el) return ''
    return typeof el.value === 'string' ? el.value : (el.textContent || '')
  }

  function fillHostDraft(text, { replace = false } = {}) {
    const value = String(text ?? '')
    if (!value) return false
    if (inputController?.insertText && inputController?.captureInsertion) {
      try {
        const span = inputController.captureInsertion()
        if (span && inputController.insertText(value, replace ? { ...span, start: 0, end: getHostDraft().length } : span)) {
          return true
        }
      } catch {
        // fall through to DOM input
      }
    }
    const el = findComposerInput()
    if (!el) return false
    if ('value' in el) {
      const current = el.value || ''
      const next = replace ? value : (current ? current + '\n' + value : value)
      const proto = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement?.prototype || {}, 'value')
      if (proto?.set) proto.set.call(el, next)
      else el.value = next
      el.dispatchEvent(new win.Event('input', { bubbles: true }))
      el.focus?.()
      return true
    }
    if (el.isContentEditable) {
      const current = el.textContent || ''
      el.textContent = replace ? value : (current ? current + '\n' + value : value)
      el.dispatchEvent(new win.Event('input', { bubbles: true }))
      el.focus?.()
      return true
    }
    return false
  }

  function sendHostMessage(text) {
    const content = String(text ?? '').trim()
    if (!content) return false
    if (typeof sendMessageHandler === 'function') {
      return sendMessageHandler(content) !== false
    }
    const filled = fillHostDraft(content, { replace: true })
    if (!filled || !doc) return false
    const form = findComposerInput()?.closest('form')
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"], button#send, button[aria-label*="发"]')
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click()
        return true
      }
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit()
        return true
      }
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }))
      return true
    }
    return filled
  }

  function openSession(id) {
    if (!id) return false
    if (typeof openSessionHandler === 'function') {
      openSessionHandler(id)
      return true
    }
    const row = doc?.querySelector(`[data-row-key="session:${id}"]`)
    if (row) {
      row.click()
      return true
    }
    return false
  }

  function getConversationMessages() {
    const fromLegacy = extractLegacyMessages(latestLegacy)
    if (fromLegacy && fromLegacy.length) return fromLegacy
    return extractDomMessages(doc)
  }

  function getLatestAssistantMessage() {
    const msgs = getConversationMessages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i].text
    }
    return ''
  }

  return {
    getSnapshot,
    update,
    setLegacy(legacy) { latestLegacy = legacy },
    setInputController(ctrl) { inputController = ctrl },
    setOpenSessionHandler(fn) { openSessionHandler = fn },
    setSendMessageHandler(fn) { sendMessageHandler = fn },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    onTransition(fn) {
      transitionListeners.add(fn)
      return () => transitionListeners.delete(fn)
    },
    openSession,
    getHostDraft,
    fillHostDraft,
    sendHostMessage,
    getConversationMessages,
    getLatestAssistantMessage,
  }
}

export function normalizeSessions(list, workspaces, statuses) {
  if (!list || list.phase !== 'ready') return []
  const archived = new Set(workspaces?.archivedSessionIds || [])
  const pinned = new Set(workspaces?.pinnedSessionIds || [])
  const rows = []
  for (const id of list.ids || []) {
    const row = list.byId?.[id]
    if (!row || row.blank || row.origin === 'subagent' || archived.has(id)) continue
    const live = statuses?.get?.(id)
    const waiting = Boolean(live?.pendingInteraction)
    const running = Boolean(live?.running ?? row.running)
    const failed = list.projectionsBySession?.[id]?.values?.conversationContinuation != null
    const status = waiting ? 'waiting' : running ? 'busy' : failed ? 'error' : 'idle'
    rows.push({
      id,
      title: row.title?.trim() || row.displayTitle?.trim() || '未命名会话',
      updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
      pinned: pinned.has(id),
      running,
      waiting,
      status,
    })
  }
  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  return rows
}
