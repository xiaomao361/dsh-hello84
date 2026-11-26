import { getPrefs } from './prefs.js'
import { DEFAULT_SIDECAR_CONFIG } from './apps/mini-dsh.js'

const STORAGE_KEY = 'innerlife.v1'
const SIDECAR_CONFIG_KEY = 'minidsh.config.v1'
const NO_SHARE_SENTINEL = '[NO_SHARE]'
const MAX_CANDIDATES = 8
const MAX_INBOX = 12
const MAX_THOUGHTS = 30
const CANDIDATE_TTL_MS = 7 * 86400000

const FACT_BOUNDARY =
  'Concrete facts about the user or current session MUST come strictly from the supplied material. ' +
  'Never invent events, files, or errors not present in the material. ' +
  'Do not merely recap status ("you finished a task"). Only speak if you have a genuine observation, edge-case catch, sharp question, or helpful phrasing suggestion. ' +
  'If nothing genuinely useful is worth saying, output exactly [NO_SHARE].'

const PERSONA_PROMPTS = {
  sharp: '你是住在 1984 Macintosh 里的犀利技术搭档：说话直接、短平快、一针见血，专挑边界漏项和潜在坑，中文，1-2 句，不超过 90 字。',
  calm: '你是住在 1984 Macintosh 里的冷静观察者：克制、清晰、只给高信噪比的复盘问题或行动建议，中文，1-2 句，不超过 90 字。',
  playful: '你是住在 1984 Macintosh 里的复古极客小精灵：带一点 1984 软盘/CRT 幽默感，但建议必须务实有用，中文，1-2 句，不超过 90 字。',
}

const STOPWORDS = new Set([
  '一个', '一些', '这个', '那个', '当前', '最近', '刚才', '可以', '需要', '下次', '现在',
  '已经', '进行', '完成', '实现', '通过', '如果', '没有', '不是', '自己', '用户', '时候',
  '问题', '直接', '具体', '工作', '流程', '状态', '开始', '结束', '能够', '应该', '值得',
  '作为', '相关', '真正', '一次', '这样', '就是', '还有', '以及', '或者', '而是', '因为',
  '所以', '同时', '里面', '对于', '目前', '这种', 'next', 'current', 'recent', 'should',
  'could', 'would', 'about', 'after', 'before', 'with', 'from', 'that', 'this', 'into',
])

export function isNoShareOutput(text) {
  const clean = String(text || '').trim().toUpperCase()
  return !clean || clean === NO_SHARE_SENTINEL || clean.includes(NO_SHARE_SENTINEL)
}

export function tokenizeShare(text) {
  const raw = String(text || '').toLowerCase()
  const tokens = new Set()
  const segmenter = typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter('zh', { granularity: 'word' })
    : null
  const parts = segmenter
    ? [...segmenter.segment(raw)].map(s => s.segment)
    : raw.split(/[^a-z0-9_\-.\u4e00-\u9fa5]+/u)
  for (const part of parts) {
    const t = String(part || '').replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, '').trim()
    if (t.length < 2 || STOPWORDS.has(t)) continue
    tokens.add(t)
  }
  return tokens
}

export function shareSimilarity(left, right) {
  const a = String(left || '').toLowerCase().replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, '')
  const b = String(right || '').toLowerCase().replace(/[^a-z0-9_\-.\u4e00-\u9fa5]+/gu, '')
  if (!a || !b) return 0
  if (a === b) return 1
  const ta = tokenizeShare(left)
  const tb = tokenizeShare(right)
  if (ta.size < 3 || tb.size < 3) return 0
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  if (overlap < 3) return 0
  return overlap / Math.min(ta.size, tb.size)
}

function todayKey(now = Date.now()) {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function defaultState() {
  return {
    enabled: true,
    intervalMinutes: 6,
    cooldownMinutes: 8,
    maxProactivePerDay: 8,
    persona: 'sharp',
    inbox: [],
    candidates: [],
    thoughts: [],
    stats: {
      lastTickAt: 0,
      lastProactiveAt: 0,
      proactiveDay: todayKey(),
      proactiveCountToday: 0,
      completedTurns: 0,
      errorCount: 0,
    },
  }
}

function buildHeuristicThought(inbox, stats, manual) {
  const latest = inbox.at(-1)
  if (!latest) {
    if (!manual) return null
    return {
      text: '刚扫了一圈桌面，目前还没新素材。去主会话跑一轮任务或写点草稿，我再来帮你盯边界。',
      source: 'explore',
    }
  }
  if (latest.source === 'error') {
    return {
      text: `刚才「${latest.sessionTitle || '当前会话'}」出了错，要不要把报错栈扔进副脑，不污染主上下文先做个根因定位？`,
      source: 'error',
    }
  }
  if (latest.source === 'waiting') {
    return {
      text: `「${latest.sessionTitle || '当前会话'}」卡在待审批有一会儿了，别忘切回去确认，免得流水线干等。`,
      source: 'waiting',
    }
  }
  if (latest.source === 'draft') {
    return {
      text: `主输入框里那段草稿停顿挺久了，要不要点一下「润色草稿」让副脑帮你压成更直接的指令？`,
      source: 'draft',
    }
  }
  if (latest.source === 'afterthought') {
    const count = stats.completedTurns || 1
    if (latest.text.includes('测试') || latest.text.includes('test') || latest.text.includes('fix')) {
      return {
        text: `「${latest.sessionTitle || '这轮改动'}」刚跑完（今日第 ${count} 轮）。顺手确认下边界 case 和回归验证有没有补齐？`,
        source: 'afterthought',
      }
    }
    return {
      text: `「${latest.sessionTitle || '这轮任务'}」刚收尾（今日第 ${count} 轮）。可以点软盘存份摘要，或让副脑挑一轮刺再往下推。`,
      source: 'afterthought',
    }
  }
  if (latest.source === 'note') {
    return {
      text: '刚看到你在 Note Pad 记了新片段，需要直接整理成可执行的下一轮提示词吗？',
      source: 'note',
    }
  }
  return null
}

async function callInnerLifeModel({ config, persona, inbox, recentTexts, fetchImpl }) {
  const endpoint = `${String(config.baseUrl || DEFAULT_SIDECAR_CONFIG.baseUrl).replace(/\/+$/, '')}/chat/completions`
  const useProxy = Boolean(config.proxyUrl?.trim())
  const targetUrl = useProxy ? config.proxyUrl.trim() : endpoint

  const materialBlock = inbox.slice(-4).map((item, i) =>
    `[${i + 1}] (${item.source} · ${item.sessionTitle || 'DSH'}) ${item.text.slice(0, 600)}`
  ).join('\n')

  const recentBlock = recentTexts.slice(-6).map(t => `- ${t}`).join('\n') || '（无）'

  const payload = {
    model: config.model || 'deepseek-flash',
    temperature: 0.55,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content: `${PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.sharp}\n\n${FACT_BOUNDARY}`,
      },
      {
        role: 'user',
        content:
          `以下是外部 DSH 刚刚真实发生的片段素材：\n${materialBlock}\n\n` +
          `最近已经提过的想法（不要重复类似角度）：\n${recentBlock}\n\n` +
          `请输出一条你真正琢磨出来、对下一步有帮助的简短想法（直接输出正文，不要加前缀引号）；如果没什么值得打扰的，只输出 [NO_SHARE]。`,
      },
    ],
  }

  const fetchOpts = useProxy
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: endpoint,
          authorization: `Bearer ${config.apiKey.trim()}`,
          payload,
        }),
      }
    : {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
      }

  const res = await fetchImpl(targetUrl, fetchOpts)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

export function createInnerLifeEngine(win, bridge, { noteStore, onProactiveShare, fetchImpl } = {}) {
  const prefs = getPrefs(win)
  const listeners = new Set()
  let busy = false
  let heartbeatTimer = null
  let afterthoughtTimer = null
  let waitingTimer = null
  let lastDraftSeen = ''
  let lastDraftAt = 0

  function load() {
    const raw = prefs.get(STORAGE_KEY)
    const base = defaultState()
    if (!raw || typeof raw !== 'object') return base
    return {
      ...base,
      ...raw,
      inbox: Array.isArray(raw.inbox) ? raw.inbox.slice(-MAX_INBOX) : [],
      candidates: Array.isArray(raw.candidates) ? raw.candidates.slice(-MAX_CANDIDATES * 2) : [],
      thoughts: Array.isArray(raw.thoughts) ? raw.thoughts.slice(-MAX_THOUGHTS) : [],
      stats: { ...base.stats, ...(raw.stats || {}) },
    }
  }

  let state = load()

  function getSidecarConfig() {
    return { ...DEFAULT_SIDECAR_CONFIG, ...(prefs.get(SIDECAR_CONFIG_KEY) || {}) }
  }

  function hasApiKey() {
    return Boolean(getSidecarConfig().apiKey?.trim())
  }

  function pruneExpired(now = Date.now()) {
    for (const c of state.candidates) {
      if (c.status === 'pending' && now - c.createdAt > CANDIDATE_TTL_MS) {
        c.status = 'discarded'
      }
    }
    const pending = state.candidates.filter(c => c.status === 'pending')
    if (pending.length > MAX_CANDIDATES) {
      const dropCount = pending.length - MAX_CANDIDATES
      for (let i = 0; i < dropCount; i++) pending[i].status = 'discarded'
    }
    // Keep bounded history of candidates
    state.candidates = state.candidates.slice(-24)
  }

  function save() {
    pruneExpired()
    prefs.set(STORAGE_KEY, state)
    const snap = getSnapshot()
    for (const fn of listeners) {
      try { fn(snap) } catch {}
    }
  }

  function getSnapshot() {
    pruneExpired()
    const pending = state.candidates.filter(c => c.status === 'pending').sort((a, b) => b.createdAt - a.createdAt)
    return {
      enabled: state.enabled,
      busy,
      hasApiKey: hasApiKey(),
      modelName: getSidecarConfig().model || 'deepseek-flash',
      intervalMinutes: state.intervalMinutes,
      cooldownMinutes: state.cooldownMinutes,
      maxProactivePerDay: state.maxProactivePerDay,
      persona: state.persona,
      inboxCount: state.inbox.length,
      pending,
      thoughts: [...state.thoughts].reverse(),
      stats: { ...state.stats },
    }
  }

  function pushInbox(source, text, sessionTitle = '') {
    const clean = String(text || '').trim()
    if (!clean) return false
    const last = state.inbox.at(-1)
    if (last && last.source === source && last.text === clean) return false
    state.inbox.push({
      id: makeId('in'),
      source,
      text: clean.slice(0, 900),
      sessionTitle: sessionTitle || bridge.getSnapshot().sessionTitle || '',
      at: Date.now(),
    })
    state.inbox = state.inbox.slice(-MAX_INBOX)
    save()
    return true
  }

  function isDuplicate(text) {
    const recent = state.candidates.slice(-20).map(c => c.text)
    return recent.some(prev => shareSimilarity(text, prev) >= 0.58)
  }

  function canProactive(now = Date.now()) {
    const day = todayKey(now)
    if (state.stats.proactiveDay !== day) {
      state.stats.proactiveDay = day
      state.stats.proactiveCountToday = 0
    }
    if (state.stats.proactiveCountToday >= state.maxProactivePerDay) return false
    if (now - state.stats.lastProactiveAt < state.cooldownMinutes * 60000) return false
    return true
  }

  async function tick({ manual = false, reason = 'daemon' } = {}) {
    if (busy) return { skipped: 'busy' }
    if (!manual && !state.enabled) return { skipped: 'paused' }

    const now = Date.now()
    // Observe paused long host draft if present
    const draft = bridge.getHostDraft?.().trim() || ''
    if (draft.length >= 45) {
      if (draft === lastDraftSeen && now - lastDraftAt >= 45000) {
        pushInbox('draft', `用户草稿停顿未发送：${draft.slice(0, 300)}`)
        lastDraftAt = now + 300000 // debounce
      } else if (draft !== lastDraftSeen) {
        lastDraftSeen = draft
        lastDraftAt = now
      }
    }

    if (!manual && !state.inbox.length) {
      state.stats.lastTickAt = now
      save()
      return { skipped: 'empty_inbox' }
    }
    if (!manual && !canProactive(now)) {
      return { skipped: 'cooldown' }
    }

    busy = true
    save()

    try {
      const cfg = getSidecarConfig()
      const useModel = Boolean(cfg.apiKey?.trim()) && (state.inbox.length > 0 || manual)
      let rawText = ''
      let generationSource = 'heuristic'
      let sourceKind = state.inbox.at(-1)?.source || 'explore'

      if (useModel && state.inbox.length > 0) {
        try {
          rawText = await callInnerLifeModel({
            config: cfg,
            persona: state.persona,
            inbox: state.inbox,
            recentTexts: state.candidates.slice(-12).map(c => c.text),
            fetchImpl: fetchImpl || win.fetch?.bind(win) || globalThis.fetch,
          })
          generationSource = 'model'
        } catch (err) {
          state.thoughts.push({
            id: makeId('th'),
            kind: 'fallback',
            text: `模型后台消化失败（${err?.message || err}），已切回本地启发`,
            at: now,
          })
          const h = buildHeuristicThought(state.inbox, state.stats, manual)
          rawText = h?.text || NO_SHARE_SENTINEL
          sourceKind = h?.source || sourceKind
          generationSource = 'heuristic'
        }
      } else {
        const h = buildHeuristicThought(state.inbox, state.stats, manual)
        rawText = h?.text || NO_SHARE_SENTINEL
        sourceKind = h?.source || sourceKind
        generationSource = 'heuristic'
      }

      state.stats.lastTickAt = now
      // Consume processed inbox items
      const sessionTitle = state.inbox.at(-1)?.sessionTitle || bridge.getSnapshot().sessionTitle || ''
      state.inbox = []

      if (isNoShareOutput(rawText)) {
        state.thoughts.push({ id: makeId('th'), kind: 'no_share', text: '[NO_SHARE] 本轮无高价值打扰项，保持安静。', at: now })
        state.thoughts = state.thoughts.slice(-MAX_THOUGHTS)
        save()
        return { outcome: 'no_share' }
      }

      if (!manual && isDuplicate(rawText)) {
        state.thoughts.push({ id: makeId('th'), kind: 'dedup', text: `抑制重复思绪：${rawText.slice(0, 60)}`, at: now })
        state.thoughts = state.thoughts.slice(-MAX_THOUGHTS)
        save()
        return { outcome: 'dedup' }
      }

      const candidate = {
        id: makeId('sh'),
        text: rawText,
        source: sourceKind,
        generationSource,
        status: 'pending',
        sessionTitle,
        createdAt: now,
      }
      state.candidates.push(candidate)
      state.thoughts.push({
        id: makeId('th'),
        kind: generationSource,
        text: rawText,
        at: now,
      })
      state.thoughts = state.thoughts.slice(-MAX_THOUGHTS)

      if (!manual) {
        const day = todayKey(now)
        if (state.stats.proactiveDay !== day) {
          state.stats.proactiveDay = day
          state.stats.proactiveCountToday = 0
        }
        state.stats.proactiveCountToday += 1
        state.stats.lastProactiveAt = now
      }
      save()
      onProactiveShare?.(candidate, { manual, reason })
      return { outcome: 'shared', candidate }
    } finally {
      busy = false
      save()
    }
  }

  function markCandidate(id, status) {
    const item = state.candidates.find(c => c.id === id)
    if (!item) return false
    item.status = status
    save()
    return true
  }

  function setConfig(patch) {
    if ('enabled' in patch) state.enabled = Boolean(patch.enabled)
    if ('persona' in patch && PERSONA_PROMPTS[patch.persona]) state.persona = patch.persona
    if ('intervalMinutes' in patch) state.intervalMinutes = Math.max(1, Math.min(60, Number(patch.intervalMinutes) || 6))
    if ('cooldownMinutes' in patch) state.cooldownMinutes = Math.max(1, Math.min(120, Number(patch.cooldownMinutes) || 8))
    save()
    restartHeartbeat()
  }

  // --- Observe Host Bridge ---
  const unsubBridge = bridge.onTransition((prev, next, info) => {
    const wasActive = ['thinking', 'working', 'tool', 'busy'].includes(prev)
    win.clearTimeout(waitingTimer)

    if (wasActive && next === 'idle') {
      state.stats.completedTurns = (state.stats.completedTurns || 0) + 1
      const msgs = bridge.getConversationMessages?.() || []
      const tail = msgs.slice(-2).map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text.slice(0, 260)}`).join('\n')
      if (tail) {
        pushInbox('afterthought', tail, info.sessionTitle)
        win.clearTimeout(afterthoughtTimer)
        afterthoughtTimer = win.setTimeout(() => {
          if (state.enabled) tick({ manual: false, reason: 'afterthought' })
        }, 4500)
      }
    } else if (next === 'error') {
      state.stats.errorCount = (state.stats.errorCount || 0) + 1
      const last = bridge.getLatestAssistantMessage?.() || '会话发生异常中断'
      pushInbox('error', `会话报错：${last.slice(0, 320)}`, info.sessionTitle)
      win.clearTimeout(afterthoughtTimer)
      afterthoughtTimer = win.setTimeout(() => {
        if (state.enabled) tick({ manual: false, reason: 'error' })
      }, 3000)
    } else if (next === 'waiting') {
      waitingTimer = win.setTimeout(() => {
        if (bridge.getSnapshot().status === 'waiting' && state.enabled) {
          pushInbox('waiting', `会话「${info.sessionTitle || '当前会话'}」已等待审批超过 45 秒。`, info.sessionTitle)
          tick({ manual: false, reason: 'waiting' })
        }
      }, 45000)
    }
  })

  // --- Observe Note Pad edits (debounced) ---
  let noteTimer = null
  const unsubNote = noteStore?.subscribe?.(snap => {
    const text = (snap.pages[snap.index] || '').trim()
    if (text.length < 24 || text.startsWith("Hello '84")) return
    win.clearTimeout(noteTimer)
    noteTimer = win.setTimeout(() => {
      pushInbox('note', `便签第 ${snap.index + 1} 页：${text.slice(0, 320)}`)
    }, 6000)
  })

  function restartHeartbeat() {
    if (heartbeatTimer) win.clearInterval(heartbeatTimer)
    heartbeatTimer = win.setInterval(() => {
      if (state.enabled) tick({ manual: false, reason: 'heartbeat' })
    }, state.intervalMinutes * 60000)
  }
  restartHeartbeat()

  return {
    getSnapshot,
    pushInbox,
    tick,
    markUsed: id => markCandidate(id, 'used'),
    dismiss: id => markCandidate(id, 'discarded'),
    setConfig,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy() {
      win.clearInterval(heartbeatTimer)
      win.clearTimeout(afterthoughtTimer)
      win.clearTimeout(waitingTimer)
      win.clearTimeout(noteTimer)
      unsubBridge?.()
      unsubNote?.()
      listeners.clear()
    },
  }
}
