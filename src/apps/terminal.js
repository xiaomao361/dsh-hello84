import { sound } from '../sound.js'
import { formatConversationMarkdown } from './floppy.js'
import { runSidecarTurn, DEFAULT_SIDECAR_CONFIG } from './mini-dsh.js'
import { getPrefs } from '../prefs.js'

const SIDECAR_CONFIG_KEY = 'minidsh.config.v1'

const MAC_ASCII = [
  '  .----------------.',
  '  | .------------. |',
  '  | |  hello.    | |',
  '  | |   ( ^_^ )  | |',
  '  | \'------------\' |',
  '  |  [=]    =====  |',
  '  \'----------------\'',
  '  Macintosh 128K · 1984',
].join('\n')

const HELP_TEXT = [
  'HELLO \'84 SHELL — 内置指令：',
  '  status              查看外部 DSH 与 InnerLife 状态',
  '  ls [sessions|notes|thoughts|apps]',
  '                      列出外部会话 / 便签 / 思绪 / 应用',
  '  cd <编号|关键词>     切换外部 DSH 会话',
  '  open <app>          打开小 Mac 应用 (notepad/floppy/alarm/innerlife/paint/mines)',
  '  draft <文本>        填入外部 DSH 输入框',
  '  send <文本>         直接发送给外部 DSH',
  '  ask <问题>          在终端内直连旁路副脑 (需配 Key)',
  '  think               触发 InnerLife 现在琢磨一下',
  '  note <内容>         记一条新便签到 Note Pad',
  '  alarm <分钟> [标签]  启动复古闹钟 (alarm reset 重置)',
  '  mode <classic|green|amber>  切换 CRT 屏幕模式',
  '  sound <on|off>      开关复古提示音',
  '  export              脱敏导出当前会话 Markdown',
  '  hello / clear       彩蛋 / 清屏',
].join('\n')

export function createTerminalEngine({ win, bridge, noteStore, alarmStore, innerLife, desktopApi }) {
  const prefs = getPrefs(win)

  async function execute(rawInput) {
    const line = String(rawInput || '').trim()
    if (!line) return { output: '' }

    const spaceIdx = line.indexOf(' ')
    const cmd = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase()
    const arg = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim()

    if (cmd === 'help' || cmd === '?') return { output: HELP_TEXT }
    if (cmd === 'clear' || cmd === 'cls') return { clear: true, output: '' }
    if (cmd === 'hello' || cmd === 'neofetch') return { output: MAC_ASCII }

    if (cmd === 'status' || cmd === 'stat') {
      const snap = bridge.getSnapshot()
      const il = innerLife?.getSnapshot?.()
      const lines = [
        `HOST WORKSPACE : ${snap.workspaceName || '默认工作区'}`,
        `HOST SESSION   : ${snap.sessionTitle || '主界面'} (${snap.status.toUpperCase()})`,
        `SYNCED SESSIONS: ${snap.sessions.length}`,
      ]
      if (il) {
        lines.push(`INNERLIFE      : ${il.enabled ? 'ON' : 'PAUSED'} · ${il.hasApiKey ? il.modelName : 'zero-key'} · pending ${il.pending.length}/8`)
      }
      return { output: lines.join('\n') }
    }

    if (cmd === 'ls') {
      const target = (arg || 'sessions').toLowerCase()
      if (target.startsWith('s')) {
        const snap = bridge.getSnapshot()
        if (!snap.sessions.length) return { output: '(暂无同步会话)' }
        return {
          output: snap.sessions.map((s, i) => {
            const mark = s.id === snap.sessionId ? '*' : ' '
            return `${mark}[${i + 1}] (${s.status}) ${s.title}`
          }).join('\n'),
        }
      }
      if (target.startsWith('n')) {
        const snap = noteStore.getSnapshot()
        return {
          output: snap.pages.map((p, i) => {
            const first = p.split('\n').find(l => l.trim()) || '(空页)'
            return `[P${i + 1}] ${first.slice(0, 48)}`
          }).join('\n'),
        }
      }
      if (target.startsWith('t') || target === 'il') {
        const list = innerLife?.getSnapshot?.().pending || []
        if (!list.length) return { output: '(InnerLife 暂无待说思绪)' }
        return { output: list.map((item, i) => `[${i + 1}] (${item.source}) ${item.text}`).join('\n') }
      }
      if (target.startsWith('a')) {
        return { output: 'mini-dsh  innerlife  terminal  notepad  floppy  alarm  macpaint  minesweeper' }
      }
      return { output: `未知列表类型: ${target}。试试 ls sessions / notes / thoughts / apps` }
    }

    if (cmd === 'cd') {
      if (!arg) return { output: '用法: cd <会话编号或标题关键词>' }
      const sessions = bridge.getSnapshot().sessions
      const idx = Number(arg)
      const hit = Number.isInteger(idx) && idx >= 1 && idx <= sessions.length
        ? sessions[idx - 1]
        : sessions.find(s => s.title.toLowerCase().includes(arg.toLowerCase()) || s.id === arg)
      if (!hit) return { output: `未找到匹配会话: ${arg}` }
      bridge.openSession(hit.id)
      return { output: `已切换外部会话 -> ${hit.title}` }
    }

    if (cmd === 'open') {
      const alias = {
        minidsh: 'mini-dsh', dsh: 'mini-dsh',
        il: 'innerlife',
        note: 'notepad', notes: 'notepad',
        disk: 'floppy',
        clock: 'alarm',
        paint: 'macpaint',
        mines: 'minesweeper', mine: 'minesweeper',
        term: 'terminal',
      }
      const id = alias[arg.toLowerCase()] || arg.toLowerCase()
      if (!id) return { output: '用法: open <mini-dsh|innerlife|notepad|floppy|alarm|macpaint|minesweeper>' }
      desktopApi?.openApp?.(id)
      return { output: `已打开应用: ${id}` }
    }

    if (cmd === 'draft' || cmd === 'fill') {
      if (!arg) return { output: '用法: draft <要填入外部输入框的文字>' }
      const ok = bridge.fillHostDraft(arg, { replace: false })
      return { output: ok ? 'OK: 已写入外部 DSH 输入框' : 'ERR: 未找到外部输入框' }
    }

    if (cmd === 'send' || cmd === 'say') {
      if (!arg) return { output: '用法: send <要直接发给外部 DSH 的消息>' }
      const ok = bridge.sendHostMessage(arg)
      return { output: ok ? 'OK: 已发送至外部 DSH' : 'ERR: 发送失败（未找到输入框）' }
    }

    if (cmd === 'note') {
      if (!arg) return { output: '用法: note <便签内容>' }
      const idx = noteStore.appendNote('Terminal', arg)
      return { output: `OK: 已写入 Note Pad 第 ${idx + 1} 页` }
    }

    if (cmd === 'alarm') {
      if (arg === 'reset' || arg === 'stop') {
        alarmStore.reset()
        return { output: 'OK: 闹钟已重置' }
      }
      const parts = arg.split(/\s+/)
      const mins = Number(parts[0])
      if (!Number.isFinite(mins) || mins <= 0) return { output: '用法: alarm <分钟数> [标签] 或 alarm reset' }
      const label = parts.slice(1).join(' ') || `${mins}m 倒计时`
      alarmStore.start(mins, label)
      return { output: `OK: 已启动 ${mins} 分钟闹钟 (${label})` }
    }

    if (cmd === 'mode') {
      const m = arg.toLowerCase()
      if (!['classic', 'green', 'amber'].includes(m)) return { output: '用法: mode <classic|green|amber>' }
      desktopApi?.applyScreenMode?.(m)
      return { output: `OK: CRT 屏幕已切换为 ${m}` }
    }

    if (cmd === 'sound') {
      if (arg !== 'on' && arg !== 'off') return { output: '用法: sound <on|off>' }
      desktopApi?.applySound?.(arg === 'on')
      return { output: `OK: 复古提示音已${arg === 'on' ? '开启' : '静音'}` }
    }

    if (cmd === 'think' || cmd === 'il') {
      if (!innerLife) return { output: 'ERR: InnerLife 未初始化' }
      const msgs = bridge.getConversationMessages?.() || []
      if (!innerLife.getSnapshot().inboxCount && msgs.length) {
        const tail = msgs.slice(-2).map(m => `${m.role}: ${m.text.slice(0, 220)}`).join('\n')
        innerLife.pushInbox('afterthought', tail)
      }
      const res = await innerLife.tick({ manual: true, reason: 'terminal' })
      if (res?.outcome === 'shared') return { output: `[InnerLife] ${res.candidate.text}` }
      if (res?.outcome === 'no_share') return { output: '[NO_SHARE] 目前没有高价值打扰项。' }
      return { output: `InnerLife tick: ${res?.outcome || res?.skipped || 'done'}` }
    }

    if (cmd === 'export') {
      const msgs = bridge.getConversationMessages()
      if (!msgs.length) return { output: '(当前会话暂无可导出消息)' }
      const md = formatConversationMarkdown(msgs, { title: bridge.getSnapshot().sessionTitle, sanitize: true })
      try { await win.navigator?.clipboard?.writeText?.(md) } catch {}
      return { output: `${md.slice(0, 420)}${md.length > 420 ? '\n...(已脱敏并尝试复制到剪贴板)' : '\n(已脱敏并尝试复制到剪贴板)'}` }
    }

    if (cmd === 'ask') {
      if (!arg) return { output: '用法: ask <问旁路副脑的问题>' }
      const cfg = { ...DEFAULT_SIDECAR_CONFIG, ...(prefs.get(SIDECAR_CONFIG_KEY) || {}) }
      try {
        const { reply, toolLogs } = await runSidecarTurn({
          config: cfg,
          messages: [{ role: 'user', content: arg }],
          toolHandlers: {
            write_note: ({ title, content }) => ({ ok: true, page: noteStore.appendNote(title || 'Terminal', content || '') + 1 }),
            set_alarm: ({ minutes, label }) => { alarmStore.start(minutes || 5, label || '终端闹钟'); return { ok: true } },
            fill_host_draft: ({ text, replace }) => ({ ok: bridge.fillHostDraft(text || '', { replace: Boolean(replace) }) }),
          },
          fetchImpl: win.fetch?.bind(win) || globalThis.fetch,
        })
        const logs = toolLogs.map(t => `[TOOL:${t.name}] ${JSON.stringify(t.result)}`).join('\n')
        return { output: (logs ? logs + '\n' : '') + reply }
      } catch (err) {
        return { output: `ERR: ${err?.message || err}` }
      }
    }

    return { output: `未知指令: ${cmd}。输入 help 查看可用命令。` }
  }

  return { execute }
}

export function renderTerminal(doc, ctx) {
  const { win } = ctx
  const engine = createTerminalEngine(ctx)
  const history = []
  let histPos = -1
  let running = false

  const root = doc.createElement('div')
  root.className = 'h84-term'
  root.innerHTML = `
    <div class="h84-term-out" data-out></div>
    <div class="h84-term-in">
      <span class="h84-term-prompt">84&gt;</span>
      <input type="text" class="h84-term-input" data-in placeholder="输入 help 查看指令…" autocomplete="off" spellcheck="false">
    </div>
  `

  const outEl = root.querySelector('[data-out]')
  const inEl = root.querySelector('[data-in]')

  function appendLine(text, kind = 'out') {
    if (!text) return
    const pre = doc.createElement('pre')
    pre.className = `h84-term-line is-${kind}`
    pre.textContent = text
    outEl.append(pre)
    outEl.scrollTop = outEl.scrollHeight
  }

  appendLine("HELLO '84 SHELL v0.2 — 输入 help 查看指令 (支持 ↑/↓ 历史)", 'sys')

  async function submit() {
    const val = inEl.value.trim()
    if (!val || running) return
    sound.click(win)
    history.push(val)
    histPos = history.length
    inEl.value = ''
    appendLine(`84> ${val}`, 'cmd')
    running = true
    try {
      const res = await engine.execute(val)
      if (res.clear) outEl.replaceChildren()
      if (res.output) appendLine(res.output, 'out')
    } finally {
      running = false
      inEl.focus()
    }
  }

  inEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp') {
      if (!history.length) return
      e.preventDefault()
      histPos = Math.max(0, histPos - 1)
      inEl.value = history[histPos] || ''
    } else if (e.key === 'ArrowDown') {
      if (!history.length) return
      e.preventDefault()
      histPos = Math.min(history.length, histPos + 1)
      inEl.value = history[histPos] || ''
    }
  })

  root.addEventListener('click', () => inEl.focus())

  return { element: root, destroy() {} }
}
