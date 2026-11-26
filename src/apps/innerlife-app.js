import { sound } from '../sound.js'

export function renderInnerLifeApp(doc, { win, bridge, innerLife, noteStore, openSidecarWithPrompt, notify }) {
  const root = doc.createElement('div')
  root.className = 'h84-innerlife'
  root.innerHTML = `
    <div class="h84-il-head">
      <div class="h84-il-status" data-status>InnerLife · 待机</div>
      <div class="h84-app-bar">
        <label class="h84-check"><input type="checkbox" data-enabled> 自动琢磨</label>
        <select class="h84-select" data-persona aria-label="小 Mac 性格">
          <option value="sharp">犀利搭档</option>
          <option value="calm">冷静观察</option>
          <option value="playful">84 极客</option>
        </select>
        <button type="button" class="h84-btn" data-act="tick">现在琢磨一下</button>
      </div>
    </div>
    <div class="h84-tabs">
      <button type="button" class="h84-tab is-active" data-tab="pending">待说思绪 (<span data-pcount>0</span>)</button>
      <button type="button" class="h84-tab" data-tab="log">琢磨日志</button>
    </div>
    <div class="h84-il-list" data-pane="pending"></div>
    <div class="h84-il-list" data-pane="log" hidden></div>
  `

  const statusEl = root.querySelector('[data-status]')
  const enabledEl = root.querySelector('[data-enabled]')
  const personaEl = root.querySelector('[data-persona]')
  const tickBtn = root.querySelector('[data-act="tick"]')
  const pcountEl = root.querySelector('[data-pcount]')
  const pendingPane = root.querySelector('[data-pane="pending"]')
  const logPane = root.querySelector('[data-pane="log"]')

  let activeTab = 'pending'

  function render() {
    const snap = innerLife.getSnapshot()
    statusEl.textContent = snap.busy
      ? 'InnerLife · 正在琢磨中…'
      : `InnerLife · ${snap.hasApiKey ? `模型 ${snap.modelName}` : '零配置启发'} · 池 ${snap.pending.length}/8 · 待消化 ${snap.inboxCount}`
    enabledEl.checked = snap.enabled
    personaEl.value = snap.persona
    tickBtn.disabled = snap.busy
    pcountEl.textContent = String(snap.pending.length)

    pendingPane.replaceChildren()
    if (!snap.pending.length) {
      const empty = doc.createElement('div')
      empty.className = 'h84-empty'
      empty.textContent = snap.hasApiKey
        ? '小 Mac 正在安静观察你在外部 DSH 的工作；有值得说的会自己冒气泡，或点上方「现在琢磨一下」。'
        : '零配置模式运行中：外部任务结束/报错时会自动记录提示；去 Mini DSH 配上 API Key 会更主动。'
      pendingPane.append(empty)
    } else {
      for (const item of snap.pending) {
        const card = doc.createElement('div')
        card.className = 'h84-il-card'
        const meta = doc.createElement('div')
        meta.className = 'h84-il-meta'
        const time = new Date(item.createdAt).toTimeString().slice(0, 5)
        meta.textContent = `[${item.generationSource === 'model' ? 'AI' : 'LOCAL'} · ${item.source}] ${time}`
        const body = doc.createElement('div')
        body.className = 'h84-il-body'
        body.textContent = item.text
        const acts = doc.createElement('div')
        acts.className = 'h84-il-acts'
        acts.innerHTML = `
          <button type="button" class="h84-btn-sm" data-share-act="fill" data-id="${item.id}">填入主框</button>
          <button type="button" class="h84-btn-sm" data-share-act="chat" data-id="${item.id}">副脑深聊</button>
          <button type="button" class="h84-btn-sm" data-share-act="note" data-id="${item.id}">存便签</button>
          <button type="button" class="h84-btn-sm" data-share-act="dismiss" data-id="${item.id}">忽略</button>
        `
        card.append(meta, body, acts)
        pendingPane.append(card)
      }
    }

    logPane.replaceChildren()
    if (!snap.thoughts.length) {
      const empty = doc.createElement('div')
      empty.className = 'h84-empty'
      empty.textContent = '暂无琢磨日志'
      logPane.append(empty)
    } else {
      for (const t of snap.thoughts) {
        const row = doc.createElement('div')
        row.className = 'h84-il-log-row'
        const time = new Date(t.at).toTimeString().slice(0, 5)
        row.textContent = `${time} [${t.kind}] ${t.text}`
        logPane.append(row)
      }
    }
  }

  const unsub = innerLife.subscribe(render)
  render()

  enabledEl.addEventListener('change', () => {
    sound.click(win)
    innerLife.setConfig({ enabled: enabledEl.checked })
    notify?.(enabledEl.checked ? 'InnerLife 自动琢磨已开启' : 'InnerLife 已暂停')
  })

  personaEl.addEventListener('change', () => {
    sound.click(win)
    innerLife.setConfig({ persona: personaEl.value })
  })

  root.addEventListener('click', async e => {
    const tab = e.target.closest('[data-tab]')
    if (tab) {
      sound.click(win)
      activeTab = tab.dataset.tab
      for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('is-active', b.dataset.tab === activeTab)
      pendingPane.hidden = activeTab !== 'pending'
      logPane.hidden = activeTab !== 'log'
      return
    }
    const tick = e.target.closest('[data-act="tick"]')
    if (tick) {
      sound.click(win)
      const msgs = bridge.getConversationMessages?.() || []
      const draft = bridge.getHostDraft?.().trim()
      if (!innerLife.getSnapshot().inboxCount) {
        const tail = msgs.slice(-2).map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text.slice(0, 260)}`).join('\n')
        if (tail) innerLife.pushInbox('afterthought', tail)
        else if (draft) innerLife.pushInbox('draft', draft)
      }
      const res = await innerLife.tick({ manual: true, reason: 'manual' })
      if (res?.outcome === 'no_share') notify?.('小 Mac 琢磨了一圈：目前没啥需要打扰你的')
      else if (res?.outcome === 'shared') notify?.('小 Mac 有新想法了！')
      return
    }
    const actBtn = e.target.closest('[data-share-act]')
    if (!actBtn) return
    sound.click(win)
    const id = actBtn.dataset.id
    const act = actBtn.dataset.shareAct
    const item = innerLife.getSnapshot().pending.find(p => p.id === id)
    if (!item) return
    if (act === 'fill') {
      const ok = bridge.fillHostDraft(item.text, { replace: false })
      if (ok) innerLife.markUsed(id)
      notify?.(ok ? '已填入外部 DSH 输入框' : '未找到外部输入框')
    } else if (act === 'chat') {
      innerLife.markUsed(id)
      openSidecarWithPrompt?.(`关于你刚才琢磨的这点：「${item.text}」——展开说说具体怎么改？`)
    } else if (act === 'note') {
      noteStore.appendNote('InnerLife', item.text)
      innerLife.markUsed(id)
      notify?.('已存入 Note Pad')
    } else if (act === 'dismiss') {
      innerLife.dismiss(id)
    }
  })

  return { element: root, destroy: unsub }
}
