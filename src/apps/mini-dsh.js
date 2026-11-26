import { getPrefs } from '../prefs.js'
import { sound } from '../sound.js'

const CONFIG_KEY = 'minidsh.config.v1'

export const DEFAULT_SIDECAR_CONFIG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  proxyUrl: '',
}

export const SIDECAR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: 'Write a snippet or summary into the Macintosh Note Pad app.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short note title' },
          content: { type: 'string', description: 'Note body text' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_alarm',
      description: 'Start a countdown timer in the Macintosh Alarm Clock app.',
      parameters: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: 'Countdown duration in minutes' },
          label: { type: 'string', description: 'Short label for the alarm' },
        },
        required: ['minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_host_draft',
      description: 'Insert or replace text in the external DSH composer input box.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to place into the host composer' },
          replace: { type: 'boolean', description: 'Whether to replace existing draft' },
        },
        required: ['text'],
      },
    },
  },
]

export async function runSidecarTurn({ config, messages, toolHandlers = {}, fetchImpl = globalThis.fetch }) {
  if (!config?.apiKey?.trim()) {
    throw new Error('请先在设置中填写 API Key（支持 DeepSeek 或任意 OpenAI 兼容接口）')
  }
  const endpoint = `${String(config.baseUrl || DEFAULT_SIDECAR_CONFIG.baseUrl).replace(/\/+$/, '')}/chat/completions`
  const useProxy = Boolean(config.proxyUrl?.trim())
  const targetUrl = useProxy ? config.proxyUrl.trim() : endpoint

  const history = [
    {
      role: 'system',
      content: '你是运行在 1984 Macintosh 里的 Mini DSH 旁路副脑。回答简洁、直接、实用，默认用中文。必要时可调用 write_note、set_alarm 或 fill_host_draft 工具。',
    },
    ...messages,
  ]

  const toolLogs = []
  let finalReply = ''

  for (let step = 0; step < 3; step++) {
    const payload = {
      model: config.model || 'deepseek-flash',
      messages: history,
      tools: SIDECAR_TOOLS,
      temperature: 0.4,
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

    let res
    try {
      res = await fetchImpl(targetUrl, fetchOpts)
    } catch (err) {
      throw new Error(`网络/CORS 请求失败：${err?.message || err}。若目标接口未开放浏览器 CORS，请在设置中填写代理地址（如 /hello84/proxy）。`)
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`接口返回 HTTP ${res.status}：${errText.slice(0, 180)}`)
    }
    const data = await res.json()
    const msg = data?.choices?.[0]?.message
    if (!msg) throw new Error('模型返回格式异常（缺少 choices[0].message）')

    const calls = msg.tool_calls || []
    if (!calls.length) {
      finalReply = msg.content || ''
      break
    }

    history.push(msg)
    for (const call of calls) {
      const name = call.function?.name
      let args = {}
      try { args = JSON.parse(call.function?.arguments || '{}') } catch {}
      let result = { ok: false, error: `Unknown tool: ${name}` }
      if (typeof toolHandlers[name] === 'function') {
        try {
          result = await toolHandlers[name](args)
        } catch (err) {
          result = { ok: false, error: String(err?.message || err) }
        }
      }
      toolLogs.push({ name, args, result })
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
    }
  }

  return { reply: finalReply || '（工具已执行完毕）', toolLogs }
}

const STATUS_GLYPH = {
  idle: '○',
  thinking: '◷',
  working: '●',
  tool: '▣',
  busy: '●',
  waiting: '!',
  error: '✕',
}

export function renderMiniDsh(doc, { win, bridge, noteStore, alarmStore, notify }) {
  const prefs = getPrefs(win)
  const savedConfig = { ...DEFAULT_SIDECAR_CONFIG, ...(prefs.get(CONFIG_KEY) || {}) }
  let activeTab = 'remote'
  let showConfig = false
  let busy = false
  const sidecarMessages = []

  const root = doc.createElement('div')
  root.className = 'h84-minidsh'
  root.innerHTML = `
    <div class="h84-tabs">
      <button type="button" class="h84-tab is-active" data-tab="remote">宿主遥控 (零配置)</button>
      <button type="button" class="h84-tab" data-tab="sidecar">旁路副脑 (配 Key)</button>
    </div>
    <div class="h84-pane" data-pane="remote">
      <div class="h84-remote-status" data-status-bar>状态：IDLE</div>
      <div class="h84-session-list" data-sessions></div>
      <div class="h84-terminal-bar">
        <input type="text" class="h84-input" data-remote-input placeholder="输入指令填入或发往外部 DSH…">
        <button type="button" class="h84-btn" data-act="fill">填入</button>
        <button type="button" class="h84-btn" data-act="send">发送</button>
      </div>
    </div>
    <div class="h84-pane" data-pane="sidecar" hidden>
      <div class="h84-app-bar">
        <button type="button" class="h84-btn" data-quick="polish">润色草稿</button>
        <button type="button" class="h84-btn" data-quick="critique">挑刺回复</button>
        <button type="button" class="h84-btn" data-quick="translate">翻译</button>
        <button type="button" class="h84-btn" data-quick="summary">总结</button>
        <button type="button" class="h84-btn" data-act="toggle-cfg">⚙ API</button>
      </div>
      <div class="h84-sidecar-cfg" data-cfg hidden>
        <label>Base URL<input type="text" data-field="baseUrl"></label>
        <label>API Key<input type="password" data-field="apiKey" placeholder="sk-..."></label>
        <label>Model<input type="text" data-field="model"></label>
        <label>Proxy (可选)<input type="text" data-field="proxyUrl" placeholder="留空直连，或填 /hello84/proxy"></label>
        <button type="button" class="h84-btn" data-act="save-cfg">保存配置</button>
      </div>
      <div class="h84-sidecar-log" data-log>
        <div class="h84-msg h84-msg-sys">READY. 配 Key 后可独立旁路问答，并可自动调用 Note Pad / Alarm / 外部草稿。</div>
      </div>
      <div class="h84-terminal-bar">
        <input type="text" class="h84-input" data-sidecar-input placeholder="问副脑，不污染主会话…">
        <button type="button" class="h84-btn" data-act="ask">问</button>
        <button type="button" class="h84-btn" data-act="clear-log">清</button>
      </div>
    </div>
  `

  const statusBar = root.querySelector('[data-status-bar]')
  const sessionsEl = root.querySelector('[data-sessions]')
  const remoteInput = root.querySelector('[data-remote-input]')
  const cfgBox = root.querySelector('[data-cfg]')
  const logEl = root.querySelector('[data-log]')
  const sidecarInput = root.querySelector('[data-sidecar-input]')

  function fillConfigInputs() {
    for (const key of ['baseUrl', 'apiKey', 'model', 'proxyUrl']) {
      cfgBox.querySelector(`[data-field="${key}"]`).value = savedConfig[key] || ''
    }
  }
  fillConfigInputs()

  function renderRemote() {
    const snap = bridge.getSnapshot()
    statusBar.textContent = `[${snap.workspaceName || 'DSH'}] ${snap.sessionTitle || '主界面'} · ${snap.status.toUpperCase()}`
    sessionsEl.replaceChildren()
    if (!snap.sessions.length) {
      const empty = doc.createElement('div')
      empty.className = 'h84-empty'
      empty.textContent = '暂无同步会话（打开 DSH 工作区后自动同步）'
      sessionsEl.append(empty)
      return
    }
    for (const s of snap.sessions) {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'h84-session-row' + (s.id === snap.sessionId ? ' is-current' : '') + (s.waiting ? ' is-waiting' : '')
      btn.dataset.openSession = s.id
      const glyph = STATUS_GLYPH[s.status] || '○'
      btn.textContent = `${glyph} ${s.title}`
      sessionsEl.append(btn)
    }
  }

  function appendLog(kind, text) {
    const item = doc.createElement('div')
    item.className = `h84-msg h84-msg-${kind}`
    item.textContent = text
    logEl.append(item)
    logEl.scrollTop = logEl.scrollHeight
  }

  const toolHandlers = {
    write_note({ title, content }) {
      const idx = noteStore.appendNote(title || 'Mini DSH', content || '')
      notify?.(`副脑已写入便签第 ${idx + 1} 页`)
      return { ok: true, page: idx + 1 }
    },
    set_alarm({ minutes, label }) {
      alarmStore.start(minutes || 5, label || '副脑提醒')
      notify?.(`副脑已设定 ${minutes} 分钟闹钟`)
      return { ok: true, minutes }
    },
    fill_host_draft({ text, replace }) {
      const ok = bridge.fillHostDraft(text || '', { replace: Boolean(replace) })
      notify?.(ok ? '副脑已回填外部草稿' : '未找到外部输入框')
      return { ok }
    },
  }

  async function askSidecar(promptText) {
    const text = String(promptText || '').trim()
    if (!text || busy) return
    busy = true
    sidecarMessages.push({ role: 'user', content: text })
    appendLog('user', `> ${text}`)
    try {
      const { reply, toolLogs } = await runSidecarTurn({
        config: savedConfig,
        messages: sidecarMessages.slice(-10),
        toolHandlers,
        fetchImpl: win.fetch?.bind(win) || globalThis.fetch,
      })
      for (const tl of toolLogs) {
        appendLog('tool', `[TOOL:${tl.name}] ${JSON.stringify(tl.result)}`)
      }
      sidecarMessages.push({ role: 'assistant', content: reply })
      appendLog('assistant', reply)
    } catch (err) {
      appendLog('error', String(err?.message || err))
    } finally {
      busy = false
    }
  }

  const unsub = bridge.subscribe(renderRemote)
  renderRemote()

  root.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-tab]')
    if (tabBtn) {
      sound.click(win)
      activeTab = tabBtn.dataset.tab
      for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('is-active', b.dataset.tab === activeTab)
      for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== activeTab
      return
    }
    const openRow = e.target.closest('[data-open-session]')
    if (openRow) {
      sound.click(win)
      bridge.openSession(openRow.dataset.openSession)
      notify?.('已切换外部 DSH 会话')
      return
    }
    const quick = e.target.closest('[data-quick]')
    if (quick) {
      sound.click(win)
      const kind = quick.dataset.quick
      const draft = bridge.getHostDraft().trim()
      const last = bridge.getLatestAssistantMessage().trim()
      if (kind === 'polish') {
        if (!draft) return notify?.('外部输入框暂无草稿')
        askSidecar(`请帮我润色以下准备发给 AI 的草稿，使其更清晰具体：\n\n${draft}`)
      } else if (kind === 'critique') {
        if (!last) return notify?.('当前会话暂无助手回复可挑刺')
        askSidecar(`请审查以下回复，指出漏洞、遗漏或潜在风险：\n\n${last.slice(0, 3000)}`)
      } else if (kind === 'translate') {
        const src = draft || last
        if (!src) return notify?.('没有可翻译的草稿或回复')
        askSidecar(`请将以下内容自然地翻译（中译英或英译中）：\n\n${src.slice(0, 3000)}`)
      } else if (kind === 'summary') {
        if (!last) return notify?.('当前会话暂无助手回复可总结')
        askSidecar(`请用 3-5 条要点总结以下内容：\n\n${last.slice(0, 3000)}`)
      }
      return
    }
    const actBtn = e.target.closest('[data-act]')
    if (!actBtn) return
    const act = actBtn.dataset.act
    sound.click(win)
    if (act === 'fill') {
      const val = remoteInput.value.trim()
      if (!val) return
      const ok = bridge.fillHostDraft(val, { replace: false })
      if (ok) remoteInput.value = ''
      notify?.(ok ? '已填入外部输入框' : '未找到外部输入框')
    } else if (act === 'send') {
      const val = remoteInput.value.trim()
      if (!val) return
      const ok = bridge.sendHostMessage(val)
      if (ok) remoteInput.value = ''
      notify?.(ok ? '已发送至外部 DSH' : '发送失败（未找到输入框）')
    } else if (act === 'toggle-cfg') {
      showConfig = !showConfig
      cfgBox.hidden = !showConfig
    } else if (act === 'save-cfg') {
      for (const key of ['baseUrl', 'apiKey', 'model', 'proxyUrl']) {
        savedConfig[key] = cfgBox.querySelector(`[data-field="${key}"]`).value.trim()
      }
      prefs.set(CONFIG_KEY, savedConfig)
      showConfig = false
      cfgBox.hidden = true
      notify?.('Sidecar API 配置已保存')
    } else if (act === 'ask') {
      const val = sidecarInput.value.trim()
      if (!val) return
      sidecarInput.value = ''
      askSidecar(val)
    } else if (act === 'clear-log') {
      sidecarMessages.length = 0
      logEl.replaceChildren()
      appendLog('sys', 'SESSION CLEARED.')
    }
  })

  remoteInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      root.querySelector('[data-act="send"]').click()
    }
  })
  sidecarInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      root.querySelector('[data-act="ask"]').click()
    }
  })

  return { element: root, destroy: unsub }
}
