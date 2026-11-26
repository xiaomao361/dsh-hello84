import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const options = {
  absWorkingDir: project,
  bundle: true,
  loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'text' },
  target: 'es2022',
  write: false,
  legalComments: 'none',
}

function mountPreview({ createHostBridge, mountHello84 }, css) {
  const get = id => document.getElementById(id)
  const sessions = new Map([
    ['s-init', {
      id: 's-init',
      title: 'Hello 84 架构验证',
      status: 'idle',
      pinned: true,
      updatedAt: Date.now() - 60000,
      messages: [
        { role: 'user', text: '帮我检查 /Users/zhouwei/projects/dsh-hello84/src/client.js 的 Shadow DOM 样式隔离是否完整。' },
        { role: 'assistant', text: '已确认：所有样式均挂载在 ShadowRoot 内，宿主无论切浅色、深色还是第三方皮肤，Hello \'84 都保持独立像素渲染。' },
      ],
    }],
    ['s-approve', {
      id: 's-approve',
      title: '发布前构建检查（待审批）',
      status: 'waiting',
      pinned: false,
      updatedAt: Date.now() - 180000,
      messages: [
        { role: 'user', text: '准备执行 npm run build 并打包。' },
        { role: 'assistant', text: '需要你批准运行打包命令，请确认是否继续。' },
      ],
    }],
    ['s-tool', {
      id: 's-tool',
      title: '日志排查与脱敏脚本',
      status: 'tool',
      pinned: false,
      updatedAt: Date.now() - 420000,
      messages: [
        { role: 'user', text: '把 /Users/alice/work/logs 里的异常提取出来。' },
        { role: 'assistant', text: '正在检索日志文件并汇总错误栈…' },
      ],
    }],
  ])

  let currentId = 's-init'

  const bridge = createHostBridge(window, {
    openSession(id) {
      if (!sessions.has(id)) return
      currentId = id
      renderHost()
    },
  })

  function snapshotSessions() {
    return [...sessions.values()].map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      running: ['thinking', 'working', 'tool', 'busy'].includes(s.status),
      waiting: s.status === 'waiting',
      pinned: s.pinned,
      updatedAt: s.updatedAt,
    }))
  }

  function renderHost() {
    const cur = sessions.get(currentId)
    get('chat-title').textContent = cur.title
    get('chat-status-badge').textContent = '状态：' + cur.status
    get('host-status').value = cur.status

    const listEl = get('session-list')
    listEl.replaceChildren()
    for (const s of sessions.values()) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('aria-selected', String(s.id === currentId))
      btn.dataset.rowKey = 'session:' + s.id
      btn.textContent = `${s.status === 'waiting' ? '! ' : s.status === 'tool' ? '▣ ' : ''}${s.title}`
      btn.addEventListener('click', () => { currentId = s.id; renderHost() })
      listEl.append(btn)
    }

    const threadEl = get('thread')
    threadEl.replaceChildren()
    for (const msg of cur.messages) {
      const div = document.createElement('div')
      div.className = 'msg ' + (msg.role === 'user' ? 'msg-user' : 'msg-assistant')
      div.dataset.chatFlowKind = msg.role
      div.textContent = msg.text
      threadEl.append(div)
    }

    bridge.update({
      workspaceName: 'Hello 84 离线沙盒',
      sessionId: cur.id,
      sessionTitle: cur.title,
      status: cur.status,
      sessions: snapshotSessions(),
    })
  }

  get('host-theme').addEventListener('change', e => {
    document.body.dataset.dark = e.target.value
  })
  get('host-status').addEventListener('change', e => {
    const cur = sessions.get(currentId)
    cur.status = e.target.value
    renderHost()
  })
  get('composer').addEventListener('submit', e => {
    e.preventDefault()
    const input = get('draft')
    const text = input.value.trim()
    if (!text) return
    const cur = sessions.get(currentId)
    cur.messages.push({ role: 'user', text })
    cur.messages.push({ role: 'assistant', text: `（模拟宿主已收到）：${text}` })
    cur.updatedAt = Date.now()
    input.value = ''
    renderHost()
  })

  renderHost()
  const widget = mountHello84(window, bridge, css)
  let open = false
  get('open-mac-btn').addEventListener('click', () => {
    open = !open
    widget.setExpanded(open)
  })
  get('tick-il-btn').addEventListener('click', () => {
    widget.innerLife.pushInbox('afterthought', '刚才完成了 Hello 84 的 Shadow DOM 隔离测试与样式修复。', sessions.get(currentId)?.title)
    widget.innerLife.tick({ manual: true, reason: 'preview' })
  })
}

const [css, shell] = await Promise.all([
  build({ ...options, entryPoints: ['src/style.css'] }),
  readFile(new URL('preview-host.html', import.meta.url), 'utf8'),
])

const js = await build({
  ...options,
  stdin: {
    resolveDir: project,
    contents: `import { createHostBridge } from './src/host-bridge.js';
      import { mountHello84 } from './src/desktop.js';
      (${mountPreview.toString()})({ createHostBridge, mountHello84 }, ${JSON.stringify(css.outputFiles[0].text)});`,
  },
  format: 'iife',
})

const html = shell.replace('<!-- client-script -->', () => `<script>${js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`)
const outputDir = new URL('../dist/', import.meta.url)
await mkdir(outputDir, { recursive: true })
await writeFile(new URL('preview.html', outputDir), html)
console.log('dist/preview.html built')
