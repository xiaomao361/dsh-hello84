import { sound } from '../sound.js'

const MODE_COLORS = {
  classic: { bg: '#ffffff', fg: '#111111' },
  green: { bg: '#07160b', fg: '#39ff7a' },
  amber: { bg: '#180f04', fg: '#ffb238' },
}

export function renderMacPaint(doc, { win, getScreenMode, notify }) {
  const root = doc.createElement('div')
  root.className = 'h84-paint'
  root.innerHTML = `
    <div class="h84-app-bar">
      <button type="button" class="h84-btn is-active" data-tool="pen">画笔</button>
      <button type="button" class="h84-btn" data-tool="spray">喷枪</button>
      <button type="button" class="h84-btn" data-tool="eraser">橡皮</button>
      <select class="h84-select" data-size aria-label="画笔粗细">
        <option value="2">2px</option>
        <option value="4" selected>4px</option>
        <option value="8">8px</option>
      </select>
      <button type="button" class="h84-btn" data-act="clear">清空</button>
      <button type="button" class="h84-btn" data-act="save">存 PNG</button>
    </div>
    <div class="h84-paint-stage">
      <canvas class="h84-paint-canvas" width="320" height="190"></canvas>
    </div>
  `

  const canvas = root.querySelector('.h84-paint-canvas')
  const ctx = canvas.getContext('2d')
  const sizeSel = root.querySelector('[data-size]')
  let tool = 'pen'
  let drawing = false

  function colors() {
    return MODE_COLORS[getScreenMode?.() || 'classic'] || MODE_COLORS.classic
  }

  function clearCanvas() {
    if (!ctx) return
    ctx.fillStyle = colors().bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  clearCanvas()

  function point(e) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(1, rect.width)
    const scaleY = canvas.height / Math.max(1, rect.height)
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    }
  }

  function paintAt(x, y) {
    if (!ctx) return
    const size = Number(sizeSel.value) || 4
    const pal = colors()
    if (tool === 'spray') {
      ctx.fillStyle = pal.fg
      const radius = size * 2.5
      for (let i = 0; i < 14; i++) {
        const dx = Math.round((Math.random() * 2 - 1) * radius)
        const dy = Math.round((Math.random() * 2 - 1) * radius)
        if (dx * dx + dy * dy <= radius * radius) {
          ctx.fillRect(x + dx, y + dy, 2, 2)
        }
      }
      return
    }
    ctx.fillStyle = tool === 'eraser' ? pal.bg : pal.fg
    ctx.fillRect(x - Math.floor(size / 2), y - Math.floor(size / 2), size, size)
  }

  canvas.addEventListener('pointerdown', e => {
    drawing = true
    canvas.setPointerCapture?.(e.pointerId)
    const pt = point(e)
    paintAt(pt.x, pt.y)
  })
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return
    const pt = point(e)
    paintAt(pt.x, pt.y)
  })
  const stop = () => { drawing = false }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-tool]')
    if (t) {
      sound.click(win)
      tool = t.dataset.tool
      for (const b of root.querySelectorAll('[data-tool]')) b.classList.toggle('is-active', b.dataset.tool === tool)
      return
    }
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    sound.click(win)
    if (act === 'clear') {
      clearCanvas()
    } else if (act === 'save') {
      const a = doc.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `macpaint-${Date.now()}.png`
      a.click()
      notify?.('MacPaint 画作已保存')
    }
  })

  return { element: root, destroy() {} }
}
