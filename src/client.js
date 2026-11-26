import { createHostBridge, normalizeSessions } from './host-bridge.js'
import { mountHello84 } from './desktop.js'

const FRAME = 'conversation.hero.frame'
const UTILITIES = 'conversation.session.header.utilities'
const INPUT_LEFT = 'conversation.input.left'

function selectActivity(chat) {
  const live = chat?.legacy
  if (live?.runningCalls?.length) return 'tool'
  const kind = live?.partial?.blocks?.at(-1)?.kind
  if (kind === 'reasoning') return 'thinking'
  if (kind === 'tool-call') return 'tool'
  if (kind === 'text' || kind === 'image') return 'working'
  return 'busy'
}

function selectFailedEnding(chat) {
  const timeline = chat?.timeline
  const turn = timeline?.turnOrder?.at?.(-1)
  const reason = timeline?.turns?.get?.(turn)?.end?.data?.reason
  return reason?.kind === 'error' || reason?.kind === 'interrupted'
}

function selectSessionState(session) {
  if (session?.promptError || session?.openState === 'error') return 'error'
  if (session?.running === true) return 'busy'
  if (session?.openState === 'open' && session?.running === false) return 'idle'
  return 'unknown'
}

window.__ModuleLoader__.load({
  id: 'dsh-hello84',
  factory(require) {
    const React = require('react')
    return {
      name: 'dsh-hello84',
      inject: ['slots', 'uiWorkspace'],
      apply(ctx) {
        const navigation = ctx.get?.('uiWorkspace')
        const bridge = createHostBridge(window, {
          openSession: id => navigation?.openSession?.(id),
        })
        const widget = mountHello84(window, bridge, __HELLO84_CSS__)

        const snapshot = v => v
        const absent = () => undefined
        const noChat = select => select(undefined)

        // Subscribe to host session catalog if available
        ctx.inject?.(['uiSession', 'sessions', 'workspaces'], scope => {
          scope.effect(() => {
            const sessionsStore = scope.get('sessions')?.list
            const workspacesStore = scope.get('workspaces')?.list
            const statusesStore = scope.get('uiSession')?.sessionStatus
            if (!sessionsStore || !workspacesStore || !statusesStore) return
            function syncCatalog() {
              const list = sessionsStore.getSnapshot()
              const workspaces = workspacesStore.getSnapshot()
              const statuses = statusesStore.getSnapshot()
              const rows = normalizeSessions(list, workspaces, statuses)
              bridge.update({ sessions: rows })
            }
            const releases = [sessionsStore, workspacesStore, statusesStore].map(s => s.subscribe(syncCatalog))
            syncCatalog()
            return () => { for (const r of releases) r() }
          })
        })

        function HeaderObserver({ sessionId, useSession, useSessions, useWorkspaces, useSessionStatus, useChat, useProjection }) {
          const state = useSession(selectSessionState) ?? 'unknown'
          const catalog = useSessions(snapshot)
          const workspaces = useWorkspaces(snapshot)
          const statuses = useSessionStatus(snapshot)
          const legacy = useChat(c => c?.legacy)
          const activity = useChat(selectActivity) ?? 'busy'
          const endedInError = useChat(selectFailedEnding)
          const canRetry = useProjection?.('conversationContinuation', v => v != null) ?? false

          const waiting = Boolean(statuses?.get?.(sessionId)?.pendingInteraction)
          const status = waiting ? 'waiting' : state === 'busy' ? activity : (endedInError || canRetry) ? 'error' : state === 'unknown' ? 'idle' : state
          const row = catalog?.byId?.[sessionId]
          const title = row?.title || row?.displayTitle || ''
          const sessions = React.useMemo(() => normalizeSessions(catalog, workspaces, statuses), [catalog, workspaces, statuses])

          React.useLayoutEffect(() => {
            bridge.setLegacy(legacy)
            bridge.update({
              status,
              sessionId,
              sessionTitle: title,
              ...(sessions.length ? { sessions } : {}),
            })
          }, [status, sessionId, title, legacy, sessions])

          return null
        }

        function UtilitySlot(props) {
          const hasChat = typeof props.useChat === 'function'
          const hasCatalog = Boolean(props.useSessions && props.useWorkspaces)
          if (!props.sessionId) return null
          return React.createElement(HeaderObserver, {
            ...props,
            key: `${hasChat}:${hasCatalog}:${props.sessionId}`,
            useChat: hasChat ? props.useChat : noChat,
            useSessions: hasCatalog ? props.useSessions : absent,
            useWorkspaces: hasCatalog ? props.useWorkspaces : absent,
          })
        }

        function InputObserver({ useInput, inputActions }) {
          const draft = useInput?.(s => s?.draft) ?? ''
          const latestDraft = React.useRef(draft)
          latestDraft.current = draft
          React.useLayoutEffect(() => {
            if (!inputActions) return
            bridge.setInputController({
              getDraft: () => latestDraft.current,
              captureInsertion: inputActions.captureInsertion,
              insertText: inputActions.insertText,
            })
            return () => bridge.setInputController(null)
          }, [inputActions])
          return null
        }

        function HeroObserver({ hero, children }) {
          React.useLayoutEffect(() => {
            if (hero) bridge.update({ status: 'idle', sessionId: null, sessionTitle: '主界面' })
          }, [hero])
          return children ?? null
        }

        ctx.slots.inject(UTILITIES, () => ctx.slots.register({ name: UTILITIES, id: 'hello84-observer' }, UtilitySlot))
        ctx.slots.inject(INPUT_LEFT, () => ctx.slots.register({ name: INPUT_LEFT, id: 'hello84-input' }, InputObserver))
        ctx.slots.inject(FRAME, () => ctx.slots.register({ name: FRAME, id: 'hello84-hero' }, HeroObserver))

        ctx.effect(() => () => {
          widget.destroy()
        })
      },
    }
  },
})
