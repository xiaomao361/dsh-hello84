import { sanitizePaths } from '../host-bridge.js'
import { sound } from '../sound.js'

export function formatConversationMarkdown(messages, { title = '', sanitize = true } = {}) {
  if (!Array.isArray(messages) || !messages.length) return ''
  const clean = text => (sanitize ? sanitizePaths(text) : String(text || ''))
  const lines = []
  if (title) lines.push(`# ${clean(title)}`, '')
  for (const msg of messages) {
    const body = clean(msg.text).trim()
    if (!body) continue
    lines.push(`## ${msg.role === 'user' ? '用户' : '助手'}`, '', body, '')
  }
  return lines.join('\n').trim()
}

const PALETTES = {
  classic: { bg: '#f4f4ec', fg: '#111111', muted: '#555550', card: '#ffffff', userBg: '#e8e8de' },
  green: { bg: '#07160b', fg: '#39ff7a', muted: '#1f9e49', card: '#0b2212', userBg: '#10311a' },
  amber: { bg: '#180f04', fg: '#ffb238', muted: '#b07419', card: '#241707', userBg: '#32200a' },
}

function wrapText(ctx, text, maxWidth) {
  const out = []
  for (const rawLine of String(text || '').split('\n')) {
    if (!rawLine) { out.push(''); continue }
    let line = ''
    for (const ch of rawLine) {
      const test = line + ch
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line)
        line = ch
      } else {
        line = test
      }
    }
    if (line) out.push(line)
  }
  return out
}

export function renderRetroCardToCanvas(canvas, { title = 'DSH Session', messages = [], screenMode = 'classic', sanitize = true } = {}) {
  const pal = PALETTES[screenMode] || PALETTES.classic
  const width = 640
  const pad = 24
  const innerW = width - pad * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const clean = text => (sanitize ? sanitizePaths(text) : String(text || ''))
  const fontBody = '14px "SF Mono", Menlo, Monaco, Consolas, monospace'
  const fontBold = 'bold 14px "SF Mono", Menlo, Monaco, Consolas, monospace'
  ctx.font = fontBody

  const blocks = []
  const maxMsgs = messages.slice(-12)
  for (const msg of maxMsgs) {
    const lines = wrapText(ctx, clean(msg.text).trim().slice(0, 1200), innerW - 36)
    blocks.push({ role: msg.role, lines: lines.slice(0, 28) })
  }

  let height = 96
  for (const b of blocks) {
    height += 26 + b.lines.length * 20 + 22
  }
  height = Math.max(240, Math.min(2600, height + 44))

  canvas.width = width
  canvas.height = height

  // Outer Macintosh desktop backdrop
  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, width, height)

  // Window frame
  const wx = 14
  const wy = 14
  const ww = width - 28
  const wh = height - 28
  ctx.fillStyle = pal.fg
  ctx.fillRect(wx + 4, wy + 4, ww, wh)
  ctx.fillStyle = pal.card
  ctx.fillRect(wx, wy, ww, wh)
  ctx.strokeStyle = pal.fg
  ctx.lineWidth = 2
  ctx.strokeRect(wx, wy, ww, wh)

  // Classic System 6 pinstriped titlebar
  const tbH = 30
  for (let y = wy + 6; y < wy + tbH - 5; y += 4) {
    ctx.beginPath()
    ctx.moveTo(wx + 28, y)
    ctx.lineTo(wx + ww - 10, y)
    ctx.strokeStyle = pal.fg
    ctx.lineWidth = 1
    ctx.stroke()
  }
  // Close box
  ctx.fillStyle = pal.card
  ctx.fillRect(wx + 8, wy + 7, 14, 14)
  ctx.strokeStyle = pal.fg
  ctx.lineWidth = 1.5
  ctx.strokeRect(wx + 8, wy + 7, 14, 14)

  // Centered title badge
  const displayTitle = ` ${clean(title || 'DSH Archive').slice(0, 32)} `
  ctx.font = fontBold
  const tw = ctx.measureText(displayTitle).width + 12
  ctx.fillStyle = pal.card
  ctx.fillRect(wx + (ww - tw) / 2, wy + 4, tw, 20)
  ctx.fillStyle = pal.fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(displayTitle, wx + ww / 2, wy + 15)

  // Divider
  ctx.beginPath()
  ctx.moveTo(wx, wy + tbH)
  ctx.lineTo(wx + ww, wy + tbH)
  ctx.lineWidth = 2
  ctx.stroke()

  // Messages
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let cy = wy + tbH + 16
  for (const b of blocks) {
    const bh = 22 + b.lines.length * 20 + 10
    if (b.role === 'user') {
      ctx.fillStyle = pal.userBg
      ctx.fillRect(wx + 14, cy, ww - 28, bh)
    }
    ctx.strokeStyle = pal.fg
    ctx.lineWidth = 1.2
    ctx.strokeRect(wx + 14, cy, ww - 28, bh)

    ctx.font = fontBold
    ctx.fillStyle = pal.fg
    ctx.fillText(b.role === 'user' ? '▸ USER' : ' ASSISTANT', wx + 24, cy + 7)

    ctx.font = fontBody
    let ly = cy + 28
    for (const line of b.lines) {
      ctx.fillText(line, wx + 24, ly)
      ly += 20
    }
    cy += bh + 12
  }

  // Footer
  ctx.font = '11px "SF Mono", Menlo, monospace'
  ctx.fillStyle = pal.muted
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  ctx.fillText(`HELLO '84 · 3.5" FLOPPY SNAPSHOT · ${stamp}`, wx + 16, wy + wh - 22)

  return canvas
}

export function renderFloppyDisk(doc, { win, bridge, getScreenMode, notify }) {
  const root = doc.createElement('div')
  root.className = 'h84-floppy'
  root.innerHTML = `
    <div class="h84-floppy-head">
      <div class="h84-floppy-meta">当前会话：<strong data-meta-title>-</strong>（<span data-meta-count>0</span> 条消息）</div>
      <label class="h84-check"><input type="checkbox" data-sanitize checked> 导出时自动脱敏本机路径</label>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-act="copy-md">复制 Markdown</button>
      <button type="button" class="h84-btn" data-act="dl-md">下载 .md</button>
      <button type="button" class="h84-btn" data-act="render-png">生成复古长图</button>
      <button type="button" class="h84-btn" data-act="dl-png" disabled>保存 PNG</button>
    </div>
    <div class="h84-floppy-preview">
      <div class="h84-floppy-empty">点击「生成复古长图」预览 1984 Macintosh 分享卡片</div>
      <canvas class="h84-floppy-canvas" hidden></canvas>
    </div>
  `

  const titleEl = root.querySelector('[data-meta-title]')
  const countEl = root.querySelector('[data-meta-count]')
  const sanitizeEl = root.querySelector('[data-sanitize]')
  const canvas = root.querySelector('.h84-floppy-canvas')
  const emptyEl = root.querySelector('.h84-floppy-empty')
  const dlPngBtn = root.querySelector('[data-act="dl-png"]')

  function refreshMeta() {
    const snap = bridge.getSnapshot()
    const msgs = bridge.getConversationMessages()
    titleEl.textContent = snap.sessionTitle || '当前对话'
    countEl.textContent = String(msgs.length)
  }

  const unsub = bridge.subscribe(refreshMeta)
  refreshMeta()

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    const snap = bridge.getSnapshot()
    const msgs = bridge.getConversationMessages()
    const sanitize = sanitizeEl.checked
    const title = snap.sessionTitle || 'DSH-Session'

    if (!msgs.length) {
      notify?.('当前会话还没有可导出的消息')
      return
    }

    if (act === 'copy-md') {
      sound.floppy(win)
      const md = formatConversationMarkdown(msgs, { title, sanitize })
      try {
        await win.navigator.clipboard.writeText(md)
        notify?.('Markdown 已写入剪贴板')
      } catch {
        notify?.('剪贴板不可用，请改用下载 .md')
      }
    } else if (act === 'dl-md') {
      sound.floppy(win)
      const md = formatConversationMarkdown(msgs, { title, sanitize })
      const blob = new win.Blob([md + '\n'], { type: 'text/markdown;charset=utf-8' })
      const url = win.URL.createObjectURL(blob)
      const a = doc.createElement('a')
      a.href = url
      a.download = `hello84-${Date.now()}.md`
      a.click()
      win.setTimeout(() => win.URL.revokeObjectURL(url), 1000)
      notify?.('已导出 Markdown 到软盘')
    } else if (act === 'render-png') {
      sound.floppy(win)
      renderRetroCardToCanvas(canvas, {
        title,
        messages: msgs,
        screenMode: getScreenMode?.() || 'classic',
        sanitize,
      })
      canvas.hidden = false
      emptyEl.hidden = true
      dlPngBtn.disabled = false
      notify?.('复古长图已渲染')
    } else if (act === 'dl-png') {
      sound.floppy(win)
      const url = canvas.toDataURL('image/png')
      const a = doc.createElement('a')
      a.href = url
      a.download = `hello84-card-${Date.now()}.png`
      a.click()
      notify?.('复古长图 PNG 已保存')
    }
  })

  return { element: root, destroy: unsub }
}
