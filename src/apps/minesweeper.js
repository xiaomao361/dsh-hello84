import { sound } from '../sound.js'

export function createMinesweeperGame(rows = 9, cols = 9, mineCount = 10, rng = Math.random) {
  let board = []
  let placed = false
  let status = 'ready' // ready | playing | won | lost
  let flags = 0
  let revealedCount = 0

  function initEmpty() {
    board = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => ({
        r, c, mine: false, revealed: false, flagged: false, adjacent: 0,
      }))
    )
    placed = false
    status = 'ready'
    flags = 0
    revealedCount = 0
  }

  function neighbors(r, c) {
    const list = []
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nr = r + dr
        const nc = c + dc
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) list.push(board[nr][nc])
      }
    }
    return list
  }

  function placeMines(safeR, safeC) {
    const candidates = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === safeR && c === safeC) continue
        candidates.push([r, c])
      }
    }
    const target = Math.min(mineCount, candidates.length)
    for (let i = 0; i < target; i++) {
      const pick = i + Math.floor(rng() * (candidates.length - i))
      ;[candidates[i], candidates[pick]] = [candidates[pick], candidates[i]]
      const [mr, mc] = candidates[i]
      board[mr][mc].mine = true
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c].adjacent = neighbors(r, c).filter(n => n.mine).length
      }
    }
    placed = true
  }

  function reveal(r, c) {
    if (status === 'won' || status === 'lost') return status
    const cell = board[r]?.[c]
    if (!cell || cell.revealed || cell.flagged) return status
    if (!placed) {
      placeMines(r, c)
      status = 'playing'
    }
    if (cell.mine) {
      cell.revealed = true
      status = 'lost'
      for (const row of board) for (const item of row) if (item.mine) item.revealed = true
      return status
    }
    const queue = [cell]
    while (queue.length) {
      const cur = queue.shift()
      if (cur.revealed || cur.flagged) continue
      cur.revealed = true
      revealedCount++
      if (cur.adjacent === 0) {
        for (const n of neighbors(cur.r, cur.c)) {
          if (!n.revealed && !n.mine) queue.push(n)
        }
      }
    }
    if (revealedCount >= rows * cols - mineCount) {
      status = 'won'
    }
    return status
  }

  function toggleFlag(r, c) {
    if (status === 'won' || status === 'lost') return status
    const cell = board[r]?.[c]
    if (!cell || cell.revealed) return status
    cell.flagged = !cell.flagged
    flags += cell.flagged ? 1 : -1
    return status
  }

  initEmpty()

  return {
    rows,
    cols,
    mineCount,
    reset: initEmpty,
    reveal,
    toggleFlag,
    getState() {
      return {
        status,
        minesLeft: mineCount - flags,
        revealedCount,
        board,
      }
    },
  }
}

export function renderMinesweeper(doc, { win, notify }) {
  const game = createMinesweeperGame(9, 9, 10)
  const root = doc.createElement('div')
  root.className = 'h84-mine'
  root.innerHTML = `
    <div class="h84-mine-bar">
      <span class="h84-mine-counter" data-left>010</span>
      <button type="button" class="h84-btn h84-mine-reset" data-reset>:-)</button>
      <span class="h84-mine-counter" data-time>000</span>
    </div>
    <div class="h84-mine-grid" data-grid></div>
    <div class="h84-mine-hint">左键翻开 · 右键插旗</div>
  `

  const leftEl = root.querySelector('[data-left]')
  const resetBtn = root.querySelector('[data-reset]')
  const timeEl = root.querySelector('[data-time]')
  const gridEl = root.querySelector('[data-grid]')

  let seconds = 0
  let timer = null

  function stopTimer() {
    if (timer) { win.clearInterval(timer); timer = null }
  }
  function ensureTimer() {
    if (timer) return
    timer = win.setInterval(() => {
      seconds = Math.min(999, seconds + 1)
      timeEl.textContent = String(seconds).padStart(3, '0')
    }, 1000)
  }

  function draw() {
    const st = game.getState()
    leftEl.textContent = String(Math.max(-99, st.minesLeft)).padStart(3, '0')
    resetBtn.textContent = st.status === 'lost' ? 'X-(' : st.status === 'won' ? 'B-)' : ':-)'
    if (st.status === 'won' || st.status === 'lost') stopTimer()
    gridEl.replaceChildren()
    for (let r = 0; r < game.rows; r++) {
      for (let c = 0; c < game.cols; c++) {
        const cell = st.board[r][c]
        const btn = doc.createElement('button')
        btn.type = 'button'
        btn.className = 'h84-mine-cell' + (cell.revealed ? ' is-open' : '') + (cell.mine && cell.revealed ? ' is-mine' : '')
        btn.dataset.r = String(r)
        btn.dataset.c = String(c)
        if (cell.revealed) {
          btn.textContent = cell.mine ? '*' : cell.adjacent ? String(cell.adjacent) : ''
        } else if (cell.flagged) {
          btn.textContent = 'P'
        }
        gridEl.append(btn)
      }
    }
  }

  gridEl.addEventListener('click', e => {
    const btn = e.target.closest('.h84-mine-cell')
    if (!btn) return
    sound.click(win)
    const prev = game.getState().status
    const next = game.reveal(Number(btn.dataset.r), Number(btn.dataset.c))
    if (next === 'playing') ensureTimer()
    if (next === 'lost' && prev !== 'lost') {
      sound.sad(win)
      notify?.('踩雷了！点笑脸重开')
    } else if (next === 'won' && prev !== 'won') {
      sound.happy(win)
      notify?.(`扫雷通关！用时 ${seconds}s`)
    }
    draw()
  })

  gridEl.addEventListener('contextmenu', e => {
    const btn = e.target.closest('.h84-mine-cell')
    if (!btn) return
    e.preventDefault()
    sound.click(win)
    game.toggleFlag(Number(btn.dataset.r), Number(btn.dataset.c))
    draw()
  })

  resetBtn.addEventListener('click', () => {
    sound.click(win)
    stopTimer()
    seconds = 0
    timeEl.textContent = '000'
    game.reset()
    draw()
  })

  draw()
  return { element: root, destroy: stopTimer }
}
