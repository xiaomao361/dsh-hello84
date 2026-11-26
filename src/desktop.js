import { getPrefs } from './prefs.js'
import { sound } from './sound.js'
import { pixelIcon, helloBootSvg } from './icons.js'
import { createNotePadStore, renderNotePad } from './apps/notepad.js'
import { renderFloppyDisk } from './apps/floppy.js'
import { createAlarmStore, renderAlarmClock } from './apps/alarm.js'
import { renderMiniDsh } from './apps/mini-dsh.js'
import { renderMacPaint } from './apps/macpaint.js'
import { renderMinesweeper } from './apps/minesweeper.js'
import { createInnerLifeEngine } from './innerlife.js'
import { renderInnerLifeApp } from './apps/innerlife-app.js'

const SCREEN_MODES = [
  { id: 'classic', label: 'Classic 1-bit' },
  { id: 'green', label: 'CRT Green' },
  { id: 'amber', label: 'CRT Amber' },
]

const STATUS_META = {
  idle: { icon: 'happyMac', label: 'IDLE', face: 'ready' },
  thinking: { icon: 'wristwatch', label: 'THINK', face: 'think' },
  working: { icon: 'miniDsh', label: 'WRITE', face: 'work' },
  tool: { icon: 'floppy', label: 'DISK', face: 'tool' },
  busy: { icon: 'wristwatch', label: 'BUSY', face: 'think' },
  waiting: { icon: 'happyMac', label: 'APPROVE!', face: 'wait' },
  error: { icon: 'sadMac', label: '0F0064', face: 'error' },
}

const IDLE_SCENES = ['happy', 'toaster', 'stars', 'clock']

const APPS = [
  { id: 'mini-dsh', title: 'Mini DSH', icon: 'miniDsh', width: 372, height: 282 },
  { id: 'innerlife', title: 'InnerLife', icon: 'innerlife', width: 368, height: 282 },
  { id: 'notepad', title: 'Note Pad', icon: 'notepad', width: 312, height: 242 },
  { id: 'floppy', title: 'Floppy', icon: 'floppy', width: 360, height: 270 },
  { id: 'alarm', title: 'Alarm', icon: 'alarm', width: 302, height: 234 },
  { id: 'macpaint', title: 'MacPaint', icon: 'macpaint', width: 356, height: 260 },
  { id: 'minesweeper', title: 'Mines', icon: 'minesweeper', width: 252, height: 276 },
]

export function mountHello84(win, bridge, cssText) {
  const doc = win.document
  const prefs = getPrefs(win)

  const host = doc.createElement('div')
  host.id = 'dsh-hello84-host'
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;'
  const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
  const styleEl = doc.createElement('style')
  styleEl.textContent = cssText || ''
  shadow.append(styleEl)

  const stage = doc.createElement('div')
  stage.className = 'h84-stage'
  shadow.append(stage)
  doc.body.append(host)

  let screenMode = prefs.get('screenMode', 'classic')
  if (!SCREEN_MODES.some(m => m.id === screenMode)) screenMode = 'classic'
  let soundOn = prefs.get('sound', false) === true
  let expanded = false
  let docked = prefs.get('docked', null)
  let hasBooted = prefs.get('skipBoot', false) === true
  let zCounter = 10
  let idleSceneIndex = 0
  let activeBubbleShare = null
  const openWindows = new Map()

  const noteStore = createNotePadStore(win)
  const alarmStore = createAlarmStore(win, bridge, (msg, kind) => {
    showAlertBanner(msg, kind)
  })
  const innerLife = createInnerLifeEngine(win, bridge, {
    noteStore,
    onProactiveShare(candidate) {
      showThoughtBubble(candidate)
    },
  })

  // --- Mini Standby Mac + Proactive Thought Bubble ---
  const miniWrap = doc.createElement('div')
  miniWrap.className = 'h84-mini-wrap'
  const savedPos = prefs.get('miniPos')
  if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
    miniWrap.style.left = `${savedPos.x}px`
    miniWrap.style.top = `${savedPos.y}px`
  } else {
    miniWrap.style.right = '22px'
    miniWrap.style.bottom = '26px'
  }

  miniWrap.innerHTML = `
    <div class="h84-bubble" data-bubble hidden>
      <div class="h84-bubble-head">
        <span class="h84-bubble-tag" data-bubble-tag> InnerLife</span>
        <button type="button" class="h84-bubble-x" data-bact="dismiss" aria-label="关闭气泡">×</button>
      </div>
      <div class="h84-bubble-text" data-bubble-text></div>
      <div class="h84-bubble-acts">
        <button type="button" class="h84-btn-sm" data-bact="fill">填入主框</button>
        <button type="button" class="h84-btn-sm" data-bact="chat">聊聊</button>
        <button type="button" class="h84-btn-sm" data-bact="note">存便签</button>
      </div>
    </div>
    <div class="h84-mini-mac" role="button" tabindex="0" aria-label="展开 Hello '84 复古 Macintosh">
      <div class="h84-mini-bezel">
        <div class="h84-mini-crt" data-mini-crt>
          <span class="h84-mini-badge" data-mini-badge hidden>0</span>
          <span class="h84-mini-glyph" data-mini-glyph></span>
          <span class="h84-mini-text" data-mini-text>IDLE</span>
        </div>
        <div class="h84-mini-chin">
          <span class="h84-rainbow-badge" aria-hidden="true"></span>
          <span class="h84-floppy-slot"><span class="h84-floppy-led" data-mini-led></span></span>
        </div>
      </div>
      <span class="h84-dock-tab" data-dock-tab>84</span>
    </div>
  `
  stage.append(miniWrap)

  // --- Full 1984 Macintosh Chassis ---
  const macWrap = doc.createElement('section')
  macWrap.className = 'h84-mac-wrap'
  macWrap.hidden = true
  macWrap.setAttribute('role', 'dialog')
  macWrap.setAttribute('aria-label', "Hello '84 Macintosh")

  macWrap.innerHTML = `
    <div class="h84-chassis">
      <div class="h84-chassis-top" data-mac-drag>
        <div class="h84-vents" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <span class="h84-model-tag">Macintosh 128K · Hello '84</span>
        <div class="h84-chassis-ctrls">
          <button type="button" class="h84-hw-btn" data-hw="mode" title="切换屏幕模式">CRT</button>
          <button type="button" class="h84-hw-btn" data-hw="sound" title="开关复古提示音"></button>
          <button type="button" class="h84-hw-btn" data-hw="collapse" title="收起为迷你待机态">—</button>
        </div>
      </div>
      <div class="h84-crt-frame">
        <div class="h84-crt-screen" data-screen>
          <header class="h84-menubar">
            <div class="h84-menu-left">
              <button type="button" class="h84-menu-item h84-apple-btn" data-menu="apple" aria-label="Apple 菜单"></button>
              <button type="button" class="h84-menu-item" data-menu="file">File</button>
              <button type="button" class="h84-menu-item" data-menu="view">View</button>
              <button type="button" class="h84-menu-item" data-menu="special">Special</button>
            </div>
            <div class="h84-menu-right">
              <span class="h84-host-pill" data-host-pill>IDLE</span>
              <span class="h84-menu-clock" data-menu-clock>12:00</span>
            </div>
          </header>
          <div class="h84-dropdown" data-dropdown hidden></div>
          <div class="h84-desktop" data-desktop>
            <div class="h84-icons-col" data-icons></div>
            <div class="h84-windows-layer" data-windows></div>
            <div class="h84-toast" data-toast hidden></div>
            <div class="h84-alert-modal" data-alert hidden>
              <div class="h84-alert-box">
                <div class="h84-alert-icon" data-alert-icon></div>
                <div class="h84-alert-body">
                  <strong data-alert-title>Happy Mac</strong>
                  <p data-alert-msg></p>
                </div>
                <button type="button" class="h84-btn" data-alert-ok>OK</button>
              </div>
            </div>
            <div class="h84-boot-overlay" data-boot hidden>
              <div class="h84-boot-inner">
                <div data-boot-svg></div>
                <div class="h84-boot-sub">Welcome to Macintosh · DeepSeek Harness</div>
                <button type="button" class="h84-btn" data-boot-skip>Skip</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="h84-chassis-chin">
        <div class="h84-chin-left">
          <span class="h84-rainbow-badge is-lg" aria-hidden="true"></span>
          <span class="h84-chin-name">Hello '84</span>
        </div>
        <div class="h84-chin-right">
          <span class="h84-mode-label" data-mode-label>Classic 1-bit</span>
          <div class="h84-floppy-drive">
            <span class="h84-floppy-led" data-main-led></span>
            <span class="h84-floppy-bevel"></span>
          </div>
        </div>
      </div>
    </div>
  `
  stage.append(macWrap)

  const miniMacEl = miniWrap.querySelector('.h84-mini-mac')
  const miniCrtEl = miniWrap.querySelector('[data-mini-crt]')
  const miniGlyphEl = miniWrap.querySelector('[data-mini-glyph]')
  const miniTextEl = miniWrap.querySelector('[data-mini-text]')
  const miniBadgeEl = miniWrap.querySelector('[data-mini-badge]')
  const miniLedEl = miniWrap.querySelector('[data-mini-led]')
  const bubbleEl = miniWrap.querySelector('[data-bubble]')
  const bubbleTagEl = miniWrap.querySelector('[data-bubble-tag]')
  const bubbleTextEl = miniWrap.querySelector('[data-bubble-text]')
  const mainLedEl = macWrap.querySelector('[data-main-led]')
  const hostPillEl = macWrap.querySelector('[data-host-pill]')
  const menuClockEl = macWrap.querySelector('[data-menu-clock]')
  const soundHwBtn = macWrap.querySelector('[data-hw="sound"]')
  const modeLabelEl = macWrap.querySelector('[data-mode-label]')
  const appleMenuBtn = macWrap.querySelector('[data-menu="apple"]')
  const dropdownEl = macWrap.querySelector('[data-dropdown]')
  const iconsColEl = macWrap.querySelector('[data-icons]')
  const windowsLayerEl = macWrap.querySelector('[data-windows]')
  const toastEl = macWrap.querySelector('[data-toast]')
  const alertEl = macWrap.querySelector('[data-alert]')
  const alertIconEl = macWrap.querySelector('[data-alert-icon]')
  const alertTitleEl = macWrap.querySelector('[data-alert-title]')
  const alertMsgEl = macWrap.querySelector('[data-alert-msg]')
  const bootEl = macWrap.querySelector('[data-boot]')
  const bootSvgSlot = macWrap.querySelector('[data-boot-svg]')

  appleMenuBtn.append(pixelIcon(doc, 'apple', 13))
  bootSvgSlot.append(helloBootSvg(doc))

  let toastTimer = null
  function notify(message) {
    if (!message) return
    toastEl.textContent = message
    toastEl.hidden = false
    win.clearTimeout(toastTimer)
    toastTimer = win.setTimeout(() => { toastEl.hidden = true }, 2600)
  }

  function showAlertBanner(message, kind = 'waiting') {
    const isError = kind === 'error'
    alertIconEl.replaceChildren(pixelIcon(doc, isError ? 'sadMac' : 'happyMac', 30))
    alertTitleEl.textContent = isError ? 'Sad Mac · 异常提醒' : 'Happy Mac · 宿主提醒'
    alertMsgEl.textContent = message
    alertEl.hidden = false
    if (!expanded) {
      miniWrap.classList.add('is-alerting')
    }
  }

  function showThoughtBubble(candidate) {
    if (!candidate) return
    activeBubbleShare = candidate
    bubbleTagEl.textContent = candidate.generationSource === 'model' ? ' InnerLife · AI' : ' InnerLife'
    bubbleTextEl.textContent = candidate.text
    bubbleEl.hidden = false
    sound.happy(win)
    if (expanded) {
      notify(`InnerLife 新思绪：${candidate.text.slice(0, 32)}…`)
    }
  }

  function hideThoughtBubble() {
    activeBubbleShare = null
    bubbleEl.hidden = true
  }

  function openSidecarWithPrompt(promptText) {
    setExpanded(true)
    openApp('mini-dsh')
    const entry = openWindows.get('mini-dsh')
    entry?.api?.switchToSidecar?.(promptText)
  }

  bubbleEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-bact]')
    if (!btn || !activeBubbleShare) return
    e.stopPropagation()
    sound.click(win)
    const share = activeBubbleShare
    const act = btn.dataset.bact
    if (act === 'dismiss') {
      innerLife.dismiss(share.id)
      hideThoughtBubble()
    } else if (act === 'fill') {
      const ok = bridge.fillHostDraft(share.text, { replace: false })
      if (ok) innerLife.markUsed(share.id)
      hideThoughtBubble()
      notify(ok ? '已填入外部 DSH 输入框' : '未找到外部输入框')
    } else if (act === 'note') {
      noteStore.appendNote('InnerLife', share.text)
      innerLife.markUsed(share.id)
      hideThoughtBubble()
      setExpanded(true)
      openApp('notepad')
    } else if (act === 'chat') {
      innerLife.markUsed(share.id)
      hideThoughtBubble()
      openSidecarWithPrompt(`关于你刚才琢磨的这点：「${share.text}」——展开说说具体怎么改？`)
    }
  })

  macWrap.querySelector('[data-alert-ok]').addEventListener('click', () => {
    sound.click(win)
    alertEl.hidden = true
    miniWrap.classList.remove('is-alerting')
  })

  function applyScreenMode(next) {
    screenMode = next
    prefs.set('screenMode', screenMode)
    stage.dataset.screenMode = screenMode
    const meta = SCREEN_MODES.find(m => m.id === screenMode) || SCREEN_MODES[0]
    modeLabelEl.textContent = meta.label
  }

  function applySound(next) {
    soundOn = Boolean(next)
    prefs.set('sound', soundOn)
    soundHwBtn.replaceChildren(pixelIcon(doc, soundOn ? 'soundOn' : 'soundOff', 12))
    soundHwBtn.title = soundOn ? '复古提示音：开' : '复古提示音：静音'
  }

  function applyDocked(side) {
    docked = side
    prefs.set('docked', side)
    miniWrap.dataset.docked = side || ''
  }

  // --- Living Mini Mac CRT Renderer ---
  function renderMiniScreen(snap) {
    const status = snap.status || 'idle'
    const meta = STATUS_META[status] || STATUS_META.idle
    miniCrtEl.dataset.scene = status === 'idle' ? IDLE_SCENES[idleSceneIndex] : status

    if (status === 'idle') {
      const scene = IDLE_SCENES[idleSceneIndex]
      if (scene === 'toaster') {
        miniGlyphEl.replaceChildren(pixelIcon(doc, 'toaster', 22))
        miniTextEl.textContent = 'TOAST'
      } else if (scene === 'stars') {
        miniGlyphEl.replaceChildren(pixelIcon(doc, 'stars', 22))
        miniTextEl.textContent = '1984'
      } else if (scene === 'clock') {
        miniGlyphEl.replaceChildren()
        const clk = doc.createElement('span')
        clk.className = 'h84-mini-clock'
        clk.textContent = new Date().toTimeString().slice(0, 5)
        miniGlyphEl.append(clk)
        miniTextEl.textContent = 'READY'
      } else {
        miniGlyphEl.replaceChildren(pixelIcon(doc, 'happyMac', 22))
        miniTextEl.textContent = 'IDLE'
      }
    } else if (status === 'working') {
      miniGlyphEl.replaceChildren()
      const bars = doc.createElement('span')
      bars.className = 'h84-code-bars'
      bars.innerHTML = '<i></i><i></i><i></i>'
      miniGlyphEl.append(bars)
      miniTextEl.textContent = 'WRITE'
    } else {
      miniGlyphEl.replaceChildren(pixelIcon(doc, meta.icon, 22))
      miniTextEl.textContent = meta.label
    }
  }

  function applyHostStatus(snap) {
    const meta = STATUS_META[snap.status] || STATUS_META.idle
    hostPillEl.textContent = meta.label
    renderMiniScreen(snap)
    const diskActive = snap.status === 'tool' || snap.status === 'working'
    miniLedEl.classList.toggle('is-lit', diskActive)
    mainLedEl.classList.toggle('is-lit', diskActive)
    miniWrap.dataset.status = snap.status
    if (snap.status === 'waiting') {
      miniWrap.classList.add('is-alerting')
    } else if (snap.status === 'idle') {
      miniWrap.classList.remove('is-alerting')
    }
  }

  const unsubInnerLife = innerLife.subscribe(ilSnap => {
    const n = ilSnap.pending.length
    miniBadgeEl.textContent = String(n)
    miniBadgeEl.hidden = n === 0
  })

  // Rotate idle screensaver every 9 seconds
  const sceneTimer = win.setInterval(() => {
    const snap = bridge.getSnapshot()
    if (snap.status === 'idle') {
      idleSceneIndex = (idleSceneIndex + 1) % IDLE_SCENES.length
      renderMiniScreen(snap)
    }
  }, 9000)

  // --- Boot Ritual ---
  let bootTimer = null
  function playBoot(force = false) {
    if (hasBooted && !force) return
    hasBooted = true
    bootEl.hidden = false
    sound.startup(win)
    bootSvgSlot.replaceChildren(helloBootSvg(doc))
    win.clearTimeout(bootTimer)
    bootTimer = win.setTimeout(() => { bootEl.hidden = true }, 2300)
  }

  macWrap.querySelector('[data-boot-skip]').addEventListener('click', () => {
    win.clearTimeout(bootTimer)
    bootEl.hidden = true
  })

  // --- Window Manager ---
  function focusWindow(winEl) {
    zCounter += 1
    winEl.style.zIndex = String(zCounter)
    for (const el of windowsLayerEl.querySelectorAll('.h84-win')) {
      el.classList.toggle('is-focused', el === winEl)
    }
  }

  function openApp(appId) {
    const def = APPS.find(a => a.id === appId)
    if (!def) return
    if (openWindows.has(appId)) {
      const existing = openWindows.get(appId)
      existing.el.hidden = false
      focusWindow(existing.el)
      return
    }
    sound.click(win)
    const winEl = doc.createElement('section')
    winEl.className = 'h84-win'
    winEl.dataset.app = appId
    const offset = (openWindows.size % 5) * 16
    winEl.style.width = `${def.width}px`
    winEl.style.height = `${def.height}px`
    winEl.style.left = `${12 + offset}px`
    winEl.style.top = `${12 + offset}px`

    const bar = doc.createElement('header')
    bar.className = 'h84-win-bar'
    bar.innerHTML = `
      <button type="button" class="h84-win-close" aria-label="关闭 ${def.title}" title="关闭"></button>
      <span class="h84-win-title">${def.title}</span>
    `

    const body = doc.createElement('div')
    body.className = 'h84-win-body'

    let instance
    const ctxArgs = {
      win,
      bridge,
      noteStore,
      alarmStore,
      innerLife,
      openSidecarWithPrompt,
      getScreenMode: () => screenMode,
      notify,
    }
    if (appId === 'mini-dsh') instance = renderMiniDsh(doc, ctxArgs)
    else if (appId === 'innerlife') instance = renderInnerLifeApp(doc, ctxArgs)
    else if (appId === 'notepad') instance = renderNotePad(doc, ctxArgs)
    else if (appId === 'floppy') instance = renderFloppyDisk(doc, ctxArgs)
    else if (appId === 'alarm') instance = renderAlarmClock(doc, ctxArgs)
    else if (appId === 'macpaint') instance = renderMacPaint(doc, ctxArgs)
    else if (appId === 'minesweeper') instance = renderMinesweeper(doc, ctxArgs)

    if (instance?.element) body.append(instance.element)
    winEl.append(bar, body)
    windowsLayerEl.append(winEl)
    openWindows.set(appId, { el: winEl, api: instance, destroy: instance?.destroy })
    focusWindow(winEl)

    winEl.addEventListener('pointerdown', () => focusWindow(winEl))
    bar.querySelector('.h84-win-close').addEventListener('click', e => {
      e.stopPropagation()
      sound.click(win)
      closeApp(appId)
    })

    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.h84-win-close')) return
      const startX = e.clientX
      const startY = e.clientY
      const origL = winEl.offsetLeft
      const origT = winEl.offsetTop
      const onMove = ev => {
        const nextL = Math.max(0, Math.min(windowsLayerEl.clientWidth - 90, origL + ev.clientX - startX))
        const nextT = Math.max(0, Math.min(windowsLayerEl.clientHeight - 36, origT + ev.clientY - startY))
        winEl.style.left = `${nextL}px`
        winEl.style.top = `${nextT}px`
      }
      const onUp = () => {
        win.removeEventListener('pointermove', onMove)
        win.removeEventListener('pointerup', onUp)
      }
      win.addEventListener('pointermove', onMove)
      win.addEventListener('pointerup', onUp)
    })
  }

  function closeApp(appId) {
    const entry = openWindows.get(appId)
    if (!entry) return
    entry.destroy?.()
    entry.el.remove()
    openWindows.delete(appId)
  }

  // --- Desktop Icons ---
  for (const app of APPS) {
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'h84-desk-icon'
    btn.dataset.openApp = app.id
    const glyph = doc.createElement('span')
    glyph.className = 'h84-desk-glyph'
    glyph.append(pixelIcon(doc, app.icon, 20))
    const label = doc.createElement('span')
    label.className = 'h84-desk-label'
    label.textContent = app.title
    btn.append(glyph, label)
    btn.addEventListener('click', () => openApp(app.id))
    iconsColEl.append(btn)
  }

  // --- Menu Bar Dropdowns ---
  let openMenu = null
  const MENUS = {
    apple: () => [
      { label: "About Hello '84…", run: () => showAlertBanner("Hello '84 v0.2 — 1984 Macintosh + InnerLife 伴生副脑。", 'info') },
      { label: '重播 hello. 开机动画', run: () => playBoot(true) },
      { label: prefs.get('skipBoot', false) ? '✓ 跳过首次开机动画' : '跳过首次开机动画', run: () => {
        const next = !prefs.get('skipBoot', false)
        prefs.set('skipBoot', next)
        notify(next ? '已设为跳过开机动画' : '已开启开机动画')
      } },
    ],
    file: () => [
      ...APPS.map(a => ({ label: `Open ${a.title}`, run: () => openApp(a.id) })),
      { label: 'Close All Windows', run: () => { for (const id of [...openWindows.keys()]) closeApp(id) } },
    ],
    view: () => SCREEN_MODES.map(m => ({
      label: `${screenMode === m.id ? '✓ ' : '  '}${m.label}`,
      run: () => { applyScreenMode(m.id); notify(`屏幕模式：${m.label}`) },
    })),
    special: () => [
      { label: 'InnerLife · 现在琢磨一下', run: () => { openApp('innerlife'); innerLife.tick({ manual: true, reason: 'menu' }) } },
      { label: soundOn ? '✓ 复古提示音 (开)' : '复古提示音 (静音)', run: () => { applySound(!soundOn); notify(soundOn ? '已开启复古提示音' : '已静音') } },
      { label: '贴边收起 (右侧)', run: () => { setExpanded(false); applyDocked('right') } },
      { label: '贴边收起 (左侧)', run: () => { setExpanded(false); applyDocked('left') } },
      { label: 'Reset Mini Position', run: () => { prefs.remove('miniPos'); applyDocked(null); miniWrap.style.left = ''; miniWrap.style.top = ''; miniWrap.style.right = '22px'; miniWrap.style.bottom = '26px' } },
    ],
  }

  function closeDropdown() {
    openMenu = null
    dropdownEl.hidden = true
  }

  macWrap.querySelector('.h84-menubar').addEventListener('click', e => {
    const item = e.target.closest('[data-menu]')
    if (!item) return
    sound.click(win)
    const name = item.dataset.menu
    if (openMenu === name) { closeDropdown(); return }
    openMenu = name
    dropdownEl.replaceChildren()
    for (const opt of MENUS[name]()) {
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = 'h84-drop-item'
      b.textContent = opt.label
      b.addEventListener('click', () => { closeDropdown(); opt.run() })
      dropdownEl.append(b)
    }
    dropdownEl.style.left = `${item.offsetLeft}px`
    dropdownEl.hidden = false
  })

  macWrap.querySelector('[data-desktop]').addEventListener('pointerdown', closeDropdown)

  // --- Hardware Buttons ---
  macWrap.querySelector('.h84-chassis-ctrls').addEventListener('click', e => {
    const btn = e.target.closest('[data-hw]')
    if (!btn) return
    sound.click(win)
    const hw = btn.dataset.hw
    if (hw === 'collapse') setExpanded(false)
    else if (hw === 'sound') applySound(!soundOn)
    else if (hw === 'mode') {
      const idx = SCREEN_MODES.findIndex(m => m.id === screenMode)
      const next = SCREEN_MODES[(idx + 1) % SCREEN_MODES.length]
      applyScreenMode(next.id)
      notify(`屏幕模式：${next.label}`)
    }
  })

  // --- Dragging Full Mac Chassis ---
  const macDragHandle = macWrap.querySelector('[data-mac-drag]')
  macDragHandle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return
    const rect = macWrap.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    macWrap.style.right = 'auto'
    macWrap.style.bottom = 'auto'
    macWrap.style.left = `${rect.left}px`
    macWrap.style.top = `${rect.top}px`
    const onMove = ev => {
      const x = Math.max(8, Math.min(win.innerWidth - rect.width - 8, rect.left + ev.clientX - startX))
      const y = Math.max(8, Math.min(win.innerHeight - 60, rect.top + ev.clientY - startY))
      macWrap.style.left = `${x}px`
      macWrap.style.top = `${y}px`
    }
    const onUp = () => {
      win.removeEventListener('pointermove', onMove)
      win.removeEventListener('pointerup', onUp)
    }
    win.addEventListener('pointermove', onMove)
    win.addEventListener('pointerup', onUp)
  })

  // --- Dragging Mini Mac + Edge Docking ---
  let miniDragged = false
  miniMacEl.addEventListener('pointerdown', e => {
    miniDragged = false
    const startX = e.clientX
    const startY = e.clientY
    const rect = miniWrap.getBoundingClientRect()
    const onMove = ev => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return
      miniDragged = true
      applyDocked(null)
      miniWrap.style.right = 'auto'
      miniWrap.style.bottom = 'auto'
      const x = Math.max(0, Math.min(win.innerWidth - rect.width, rect.left + ev.clientX - startX))
      const y = Math.max(0, Math.min(win.innerHeight - rect.height, rect.top + ev.clientY - startY))
      miniWrap.style.left = `${x}px`
      miniWrap.style.top = `${y}px`
    }
    const onUp = () => {
      win.removeEventListener('pointermove', onMove)
      win.removeEventListener('pointerup', onUp)
      if (!miniDragged) return
      const cur = miniWrap.getBoundingClientRect()
      if (cur.left <= 14) {
        applyDocked('left')
      } else if (win.innerWidth - cur.right <= 14) {
        applyDocked('right')
      } else {
        prefs.set('miniPos', { x: Math.round(cur.left), y: Math.round(cur.top) })
      }
    }
    win.addEventListener('pointermove', onMove)
    win.addEventListener('pointerup', onUp)
  })

  function setExpanded(next) {
    expanded = Boolean(next)
    macWrap.hidden = !expanded
    miniWrap.hidden = expanded
    if (expanded) {
      miniWrap.classList.remove('is-alerting')
      playBoot(false)
      if (!openWindows.size) openApp('mini-dsh')
    }
  }

  miniMacEl.addEventListener('click', () => {
    if (miniDragged) return
    sound.click(win)
    setExpanded(true)
  })
  miniMacEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpanded(true)
    }
  })

  // --- Clock ---
  function tickClock() {
    menuClockEl.textContent = new Date().toTimeString().slice(0, 5)
    if (bridge.getSnapshot().status === 'idle' && IDLE_SCENES[idleSceneIndex] === 'clock') {
      renderMiniScreen(bridge.getSnapshot())
    }
  }
  tickClock()
  const clockTimer = win.setInterval(tickClock, 15000)

  // --- Init ---
  applyScreenMode(screenMode)
  applySound(soundOn)
  applyDocked(docked)
  applyHostStatus(bridge.getSnapshot())
  const unsubBridge = bridge.subscribe(applyHostStatus)

  return {
    host,
    shadow,
    innerLife,
    setExpanded,
    openApp,
    closeApp,
    applyScreenMode,
    getScreenMode: () => screenMode,
    destroy() {
      win.clearInterval(clockTimer)
      win.clearInterval(sceneTimer)
      win.clearTimeout(toastTimer)
      win.clearTimeout(bootTimer)
      unsubBridge()
      unsubInnerLife()
      innerLife.destroy()
      alarmStore.destroy()
      for (const id of [...openWindows.keys()]) closeApp(id)
      host.remove()
    },
  }
}
