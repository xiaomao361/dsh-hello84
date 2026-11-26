import { getPrefs } from '../prefs.js'
import { sound } from '../sound.js'

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function createAlarmStore(win, bridge, onRing) {
  const prefs = getPrefs(win)
  const listeners = new Set()
  let timer = null

  let state = {
    running: false,
    paused: false,
    remaining: 25 * 60,
    total: 25 * 60,
    label: '番茄钟',
    watchComplete: prefs.get('alarm.watchComplete', true),
    watchAttention: prefs.get('alarm.watchAttention', true),
  }

  function emit() {
    const snap = { ...state }
    for (const fn of listeners) {
      try { fn(snap) } catch {}
    }
  }

  function stopInterval() {
    if (timer) {
      win.clearInterval(timer)
      timer = null
    }
  }

  function start(minutes = 25, label = '倒计时') {
    const secs = Math.max(1, Math.round(Number(minutes) * 60))
    stopInterval()
    state = { ...state, running: true, paused: false, remaining: secs, total: secs, label: label || '倒计时' }
    timer = win.setInterval(() => {
      if (!state.running || state.paused) return
      state.remaining = Math.max(0, state.remaining - 1)
      if (state.remaining <= 0) {
        stopInterval()
        state.running = false
        state.paused = false
        sound.alarm(win, false)
        onRing?.(`闹钟到点：${state.label}`, 'alarm')
      }
      emit()
    }, 1000)
    emit()
  }

  function togglePause() {
    if (!state.running) return
    state.paused = !state.paused
    emit()
  }

  function reset() {
    stopInterval()
    state = { ...state, running: false, paused: false, remaining: state.total }
    emit()
  }

  function setWatch(key, value) {
    const bool = Boolean(value)
    state[key] = bool
    prefs.set(`alarm.${key}`, bool)
    emit()
  }

  const unsubBridge = bridge.onTransition((prev, next, info) => {
    const wasActive = ['thinking', 'working', 'tool', 'busy'].includes(prev)
    if (state.watchComplete && wasActive && next === 'idle') {
      sound.happy(win)
      onRing?.(`外部任务已完成：${info.sessionTitle || '当前会话'}`, 'complete')
    } else if (state.watchAttention && next === 'waiting') {
      sound.happy(win)
      onRing?.(`外部会话等待审批：${info.sessionTitle || '当前会话'}`, 'waiting')
    } else if (state.watchAttention && next === 'error') {
      sound.sad(win)
      onRing?.(`外部会话发生异常：${info.sessionTitle || '当前会话'}`, 'error')
    }
  })

  return {
    getSnapshot: () => ({ ...state }),
    start,
    togglePause,
    reset,
    setWatch,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy() {
      stopInterval()
      unsubBridge()
      listeners.clear()
    },
  }
}

export function renderAlarmClock(doc, { win, alarmStore, notify }) {
  const root = doc.createElement('div')
  root.className = 'h84-alarm'
  root.innerHTML = `
    <div class="h84-alarm-face">
      <div class="h84-alarm-clock" data-wall>00:00:00</div>
      <div class="h84-alarm-countdown" data-cd>25:00</div>
      <div class="h84-alarm-label" data-label>番茄钟 · 待机</div>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-preset="5">5m</button>
      <button type="button" class="h84-btn" data-preset="15">15m</button>
      <button type="button" class="h84-btn" data-preset="25">25m</button>
      <input type="number" class="h84-input-num" data-custom min="1" max="180" value="10" aria-label="自定义分钟">
      <button type="button" class="h84-btn" data-act="start-custom">启动</button>
    </div>
    <div class="h84-app-bar">
      <button type="button" class="h84-btn" data-act="pause">暂停/继续</button>
      <button type="button" class="h84-btn" data-act="reset">重置</button>
      <button type="button" class="h84-btn" data-act="ding">试听叮一声</button>
    </div>
    <div class="h84-alarm-watches">
      <label class="h84-check"><input type="checkbox" data-watch="watchComplete"> 外部 DSH 任务跑完时叮我</label>
      <label class="h84-check"><input type="checkbox" data-watch="watchAttention"> 卡审批 / 报错时弹窗提醒</label>
    </div>
  `

  const wallEl = root.querySelector('[data-wall]')
  const cdEl = root.querySelector('[data-cd]')
  const labelEl = root.querySelector('[data-label]')
  const customInput = root.querySelector('[data-custom]')
  const watchCompleteEl = root.querySelector('[data-watch="watchComplete"]')
  const watchAttentionEl = root.querySelector('[data-watch="watchAttention"]')

  function tickWall() {
    const now = new Date()
    wallEl.textContent = now.toTimeString().slice(0, 8)
  }
  tickWall()
  const wallTimer = win.setInterval(tickWall, 1000)

  function sync() {
    const snap = alarmStore.getSnapshot()
    cdEl.textContent = formatDuration(snap.remaining)
    labelEl.textContent = `${snap.label} · ${snap.running ? (snap.paused ? '已暂停' : '计时中') : '待机'}`
    watchCompleteEl.checked = snap.watchComplete
    watchAttentionEl.checked = snap.watchAttention
  }

  const unsub = alarmStore.subscribe(sync)
  sync()

  root.addEventListener('click', e => {
    const preset = e.target.closest('[data-preset]')
    if (preset) {
      sound.click(win)
      const mins = Number(preset.dataset.preset)
      alarmStore.start(mins, `${mins} 分钟专注`)
      notify?.(`已启动 ${mins} 分钟倒计时`)
      return
    }
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    sound.click(win)
    if (act === 'start-custom') {
      const mins = Math.max(1, Number(customInput.value) || 10)
      alarmStore.start(mins, `${mins} 分钟倒计时`)
      notify?.(`已启动 ${mins} 分钟倒计时`)
    } else if (act === 'pause') {
      alarmStore.togglePause()
    } else if (act === 'reset') {
      alarmStore.reset()
    } else if (act === 'ding') {
      sound.alarm(win, true)
      notify?.('叮！复古提示音测试')
    }
  })

  root.addEventListener('change', e => {
    const w = e.target.closest('[data-watch]')
    if (!w) return
    alarmStore.setWatch(w.dataset.watch, w.checked)
  })

  return {
    element: root,
    destroy() {
      win.clearInterval(wallTimer)
      unsub()
    },
  }
}
