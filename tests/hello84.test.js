import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

import { createHostBridge, sanitizePaths, normalizeSessions } from '../src/host-bridge.js'
import { createNotePadStore } from '../src/apps/notepad.js'
import { formatConversationMarkdown } from '../src/apps/floppy.js'
import { createAlarmStore, formatDuration } from '../src/apps/alarm.js'
import { runSidecarTurn } from '../src/apps/mini-dsh.js'
import { createMinesweeperGame } from '../src/apps/minesweeper.js'
import { createInnerLifeEngine, isNoShareOutput, shareSimilarity } from '../src/innerlife.js'
import { mountHello84 } from '../src/desktop.js'

function makeDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-conversation-content>
      <div data-chat-flow-kind="user">帮我查 /Users/zhouwei/secret/app.js</div>
      <div data-chat-flow-kind="assistant">已检查完成，建议加单测。</div>
    </div>
    <form id="composer"><textarea id="draft" data-composer-input></textarea><button id="send" type="submit">发送</button></form>
  </body></html>`, { url: 'http://localhost/' })
  return dom.window
}

test('sanitizePaths masks macOS, Linux and Windows user paths', () => {
  assert.equal(sanitizePaths('/Users/zhouwei/projects/app'), '/Users/<user>/projects/app')
  assert.equal(sanitizePaths('/home/alice/code/a.ts'), '/home/<user>/code/a.ts')
  assert.equal(sanitizePaths('C:\\Users\\Bob\\Desktop\\x.txt'), 'C:\\Users\\<user>\\Desktop\\x.txt')
})

test('HostBridge reads messages, fills host draft, and emits status transitions', () => {
  const win = makeDom()
  const transitions = []
  const bridge = createHostBridge(win, { initialState: { status: 'idle', sessionId: 's1', sessionTitle: 'Demo' } })
  bridge.onTransition((prev, next) => transitions.push([prev, next]))

  bridge.update({ status: 'thinking' })
  bridge.update({ status: 'waiting' })
  assert.deepEqual(transitions, [['idle', 'thinking'], ['thinking', 'waiting']])

  assert.equal(bridge.fillHostDraft('hello from mac'), true)
  assert.equal(bridge.getHostDraft(), 'hello from mac')

  const msgs = bridge.getConversationMessages()
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'user')
  assert.equal(bridge.getLatestAssistantMessage(), '已检查完成，建议加单测。')
})

test('normalizeSessions sorts pinned first and marks waiting/running states', () => {
  const list = {
    phase: 'ready',
    ids: ['a', 'b'],
    byId: {
      a: { id: 'a', title: 'Old Pinned', updatedAt: 100, running: false },
      b: { id: 'b', title: 'New Waiting', updatedAt: 200, running: true },
    },
  }
  const workspaces = { pinnedSessionIds: ['a'], archivedSessionIds: [] }
  const statuses = new Map([['b', { running: true, pendingInteraction: { kind: 'approval' } }]])
  const rows = normalizeSessions(list, workspaces, statuses)
  assert.equal(rows[0].id, 'a')
  assert.equal(rows[1].status, 'waiting')
})

test('NotePadStore persists pages, flips pages, and appends sidecar notes', () => {
  const win = makeDom()
  const store = createNotePadStore(win)
  store.setPageText('First page draft')
  store.nextPage()
  store.setPageText('Second page draft')
  const idx = store.appendNote('Review', 'Fix edge case')
  assert.equal(idx, 2)
  const reloaded = createNotePadStore(win)
  assert.equal(reloaded.getSnapshot().pages[0], 'First page draft')
  assert.match(reloaded.getSnapshot().pages[2], /\[Review\]/)
})

test('Floppy Disk formats sanitized Markdown export', () => {
  const md = formatConversationMarkdown([
    { role: 'user', text: '查看 /Users/zhouwei/file.js' },
    { role: 'assistant', text: '搞定。' },
  ], { title: 'Test Session', sanitize: true })
  assert.match(md, /# Test Session/)
  assert.match(md, /\/Users\/<user>\/file\.js/)
  assert.match(md, /## 助手/)
})

test('AlarmStore triggers callbacks on host task completion and waiting', () => {
  const win = makeDom()
  const rings = []
  const bridge = createHostBridge(win, { initialState: { status: 'working', sessionId: 's1', sessionTitle: 'Build' } })
  const alarm = createAlarmStore(win, bridge, (msg, kind) => rings.push({ msg, kind }))
  bridge.update({ status: 'idle' })
  bridge.update({ status: 'waiting' })
  assert.equal(rings.length, 2)
  assert.equal(rings[0].kind, 'complete')
  assert.equal(rings[1].kind, 'waiting')
  assert.equal(formatDuration(125), '02:05')
  alarm.destroy()
})

test('Mini DSH Sidecar executes OpenAI-compatible tool calls and returns final reply', async () => {
  let step = 0
  let wrote = null
  const fakeFetch = async () => {
    step++
    if (step === 1) {
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'write_note', arguments: JSON.stringify({ title: 'TODO', content: 'Ship Hello 84' }) },
                }],
              },
            }],
          }
        },
      }
    }
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { role: 'assistant', content: '已经帮你记到便签里了。' } }] }
      },
    }
  }

  const res = await runSidecarTurn({
    config: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-flash' },
    messages: [{ role: 'user', content: '记个便签' }],
    toolHandlers: {
      write_note(args) { wrote = args; return { ok: true, page: 1 } },
    },
    fetchImpl: fakeFetch,
  })

  assert.deepEqual(wrote, { title: 'TODO', content: 'Ship Hello 84' })
  assert.equal(res.toolLogs.length, 1)
  assert.equal(res.reply, '已经帮你记到便签里了。')
})

test('Minesweeper never hits a mine on first click and supports flagging & win', () => {
  const game = createMinesweeperGame(4, 4, 2, () => 0)
  const st1 = game.reveal(0, 0)
  assert.equal(st1, 'playing')
  const board = game.getState().board
  const mineCell = board.flat().find(c => c.mine)
  assert.ok(mineCell)
  game.toggleFlag(mineCell.r, mineCell.c)
  assert.equal(game.getState().minesLeft, 1)
  // Reveal all safe cells
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (!board[r][c].mine && !board[r][c].flagged) game.reveal(r, c)
    }
  }
  assert.equal(game.getState().status, 'won')
})

test('mountHello84 mounts in Shadow DOM, switches screen modes, and opens apps cleanly', () => {
  const win = makeDom()
  const bridge = createHostBridge(win, { initialState: { status: 'idle', sessionId: 's1', sessionTitle: 'Demo', sessions: [] } })
  const widget = mountHello84(win, bridge, '.h84-stage{}')
  assert.ok(win.document.getElementById('dsh-hello84-host'))
  widget.setExpanded(true)
  widget.applyScreenMode('green')
  assert.equal(widget.getScreenMode(), 'green')
  widget.openApp('notepad')
  widget.openApp('innerlife')
  widget.openApp('minesweeper')
  assert.ok(widget.shadow.querySelector('[data-app="notepad"]'))
  assert.ok(widget.shadow.querySelector('[data-app="innerlife"]'))
  assert.ok(widget.shadow.querySelector('[data-app="minesweeper"]'))
  widget.destroy()
  assert.equal(win.document.getElementById('dsh-hello84-host'), null)
})

test('InnerLife honors [NO_SHARE], dedup similarity, and model-backed proactive shares', async () => {
  assert.equal(isNoShareOutput('[NO_SHARE]'), true)
  assert.equal(isNoShareOutput('检查一下边界条件'), false)
  assert.ok(shareSimilarity('刚才修改了接口参数校验逻辑，建议补个空值单测。', '刚才修改了接口参数校验逻辑，建议补个空值单测验证。') >= 0.58)

  const win = makeDom()
  const bridge = createHostBridge(win, { initialState: { status: 'idle', sessionId: 's1', sessionTitle: 'API 重构' } })
  const shared = []
  let callIndex = 0
  const fakeFetch = async () => {
    callIndex++
    const content = callIndex === 1
      ? '[NO_SHARE]'
      : '刚才改了接口参数校验，别忘了把空数组和超时重试的边界单测一起补上。'
    return {
      ok: true,
      async json() { return { choices: [{ message: { content } }] } },
    }
  }

  // Configure API key so model path runs
  win.localStorage.setItem('dsh-hello84.minidsh.config.v1', JSON.stringify({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    model: 'deepseek-flash',
  }))

  const il = createInnerLifeEngine(win, bridge, {
    onProactiveShare: item => shared.push(item),
    fetchImpl: fakeFetch,
  })

  il.pushInbox('afterthought', '改完 API 参数校验')
  const r1 = await il.tick({ manual: true })
  assert.equal(r1.outcome, 'no_share')
  assert.equal(shared.length, 0)

  il.pushInbox('afterthought', '改完 API 参数校验，准备提交')
  const r2 = await il.tick({ manual: true })
  assert.equal(r2.outcome, 'shared')
  assert.equal(shared.length, 1)
  assert.equal(il.getSnapshot().pending.length, 1)

  // Duplicate suppression on non-manual tick
  il.setConfig({ cooldownMinutes: 0 })
  il.pushInbox('afterthought', '再次确认参数校验')
  const r3 = await il.tick({ manual: false })
  assert.equal(r3.outcome, 'dedup')
  assert.equal(il.getSnapshot().pending.length, 1)

  il.destroy()
})
