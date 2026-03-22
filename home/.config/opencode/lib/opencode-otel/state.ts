import { SpanStatusCode, type Context, type Span, type SpanStatus } from '@opentelemetry/api'

import {
  assistantAttributes,
  llmCallAttributes,
  sessionAttributes,
  stepFinishAttributes,
  toolFinishAttributes,
  toolStartAttributes,
  userMessageAttributes,
} from './spans.ts'

type SpanEntry = {
  span: Span
  context: Context
  ended: boolean
  status?: SpanStatus
}

type SessionEntry = SpanEntry & {
  sessionID: string
}

type SessionRecord = {
  sessionID: string
  info: Record<string, unknown>
  parentSessionID: string | null
  status: string
  originUserMessageID: string | null
  activeUserMessageID: string | null
  spanEntry: SessionEntry | null
  pendingActions: Array<() => void>
  flushing: boolean
}

type UserMessageEntry = SpanEntry & {
  messageID: string
  sessionID: string
  queued: boolean
}

type LlmCallEntry = SpanEntry & {
  sessionID: string
  parentMessageID: string
  text: string
  startedAt: number
  firstChunkAt: number | null
}

type ToolEntry = SpanEntry & {
  sessionID: string
  callID: string
}

type ToolLink = {
  sessionID: string
  messageID: string
  tool?: string
  partID?: string
  callID?: string
  childSessionID?: string
}

type ChildSessionParent = {
  callID: string
  context: Context
}

type RuntimeEvent = {
  type?: string
  properties?: Record<string, any>
}

type RuntimeConfigMetadata = {
  userID?: string
}

type PromptSnapshot = {
  messages?: Array<Record<string, any>>
  system?: string[]
}

type StartSpan = (input: {
  name: string
  parentContext?: Context
  attributes?: Record<string, unknown>
}) => { span: Span; context: Context }

const openSpan = ({
  startSpan,
  name,
  parentContext,
  attributes,
  extra = {},
}: {
  startSpan: StartSpan
  name: string
  parentContext?: Context
  attributes?: Record<string, unknown>
  extra?: Record<string, unknown>
}) => {
  const { span, context } = startSpan({ name, parentContext, attributes })
  return { ...extra, span, context, ended: false, status: undefined }
}

const setEntryStatus = (entry: SpanEntry, status: SpanStatus) => {
  entry.span.setStatus(status)
  entry.status = status
}

const setDefinedAttributes = (
  span: Span,
  attributes: Record<string, unknown>,
) => {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) span.setAttribute(key, value as any)
  }
}

const endSpan = (entry: SpanEntry | null | undefined, status?: SpanStatus) => {
  if (!entry || entry.ended) return

  if (status) setEntryStatus(entry, status)
  else if (entry.status?.code !== SpanStatusCode.ERROR) {
    setEntryStatus(entry, { code: SpanStatusCode.OK })
  }

  entry.span.end()
  entry.ended = true
}

export const createTracingLifecycle = ({ startSpan }: { startSpan: StartSpan }) => {
  const state = {
    sessions: new Map<string, SessionRecord>(),
    userMessages: new Map<string, UserMessageEntry>(),
    llmCalls: new Map<string, LlmCallEntry>(),
    toolCalls: new Map<string, ToolEntry>(),
    toolLinks: new Map<string, ToolLink>(),
    sessionMessageIDs: new Map<string, Set<string>>(),
    childSessionParents: new Map<string, ChildSessionParent>(),
    taskCallChildren: new Map<string, string>(),
    promptSnapshots: new Map<string, PromptSnapshot>(),
    runtimeConfig: {} as RuntimeConfigMetadata,
  }

  const getRuntimeMetadata = (sessionID?: string) => ({
    sessionID,
    userID: state.runtimeConfig.userID,
  })

  const sessionMessages = (sessionID: string) => {
    const ids = state.sessionMessageIDs.get(sessionID)
    if (ids) return ids
    const created = new Set<string>()
    state.sessionMessageIDs.set(sessionID, created)
    return created
  }

  const updateSessionSpanAttributes = (session: SessionRecord) => {
    if (!session.spanEntry) return

    setDefinedAttributes(
      session.spanEntry.span,
      sessionAttributes({
        id: session.sessionID,
        ...session.info,
        parentID: session.parentSessionID,
        parentToolCallID: state.childSessionParents.get(session.sessionID)?.callID,
      }),
    )
  }

  const flushPendingActions = (session: SessionRecord) => {
    if (!session.spanEntry || session.flushing || session.pendingActions.length === 0) return

    session.flushing = true
    try {
      while (session.pendingActions.length > 0) {
        const actions = session.pendingActions.splice(0)
        for (const action of actions) action()
      }
    } finally {
      session.flushing = false
    }
  }

  const materializeSession = (session: SessionRecord) => {
    if (session.spanEntry) return true

    let parentContext: Context | undefined
    if (session.parentSessionID) {
      const parent = state.childSessionParents.get(session.sessionID)
      if (!parent) return false
      parentContext = parent.context
    }

    session.spanEntry = openSpan({
      startSpan,
      name: 'session',
      parentContext,
      attributes: sessionAttributes({
        id: session.sessionID,
        ...session.info,
        parentID: session.parentSessionID,
        parentToolCallID: state.childSessionParents.get(session.sessionID)?.callID,
      }),
      extra: {
        sessionID: session.sessionID,
      },
    }) as SessionEntry

    flushPendingActions(session)
    return true
  }

  const ensureSession = (sessionID: string, info: Record<string, unknown> = {}) => {
    let session = state.sessions.get(sessionID)
    if (!session) {
      session = {
        sessionID,
        info: {},
        parentSessionID: null,
        status: 'idle',
        originUserMessageID: null,
        activeUserMessageID: null,
        spanEntry: null,
        pendingActions: [],
        flushing: false,
      }
      state.sessions.set(sessionID, session)
    }

    if (Object.keys(info).length > 0) {
      session.info = { ...session.info, ...info }
      const parentSessionID = typeof info.parentID === 'string' ? info.parentID : session.parentSessionID
      session.parentSessionID = parentSessionID || null
      updateSessionSpanAttributes(session)
    }

    materializeSession(session)
    return session
  }

  const withSession = (
    sessionID: string,
    action: () => void,
    info: Record<string, unknown> = {},
  ) => {
    const session = ensureSession(sessionID, info)
    if (!session.spanEntry) {
      session.pendingActions.push(action)
      return null
    }
    return session
  }

  const resolveChildSessionParent = (childSessionID: string, callID: string) => {
    const entry = state.toolCalls.get(callID)
    if (!entry) return

    state.childSessionParents.set(childSessionID, {
      callID,
      context: entry.context,
    })
    state.taskCallChildren.set(callID, childSessionID)

    const session = state.sessions.get(childSessionID)
    if (session) {
      materializeSession(session)
      updateSessionSpanAttributes(session)
    }
  }

  const getCurrentUserEntry = (session: SessionRecord | null) => {
    if (!session) return null
    if (session.activeUserMessageID) {
      const active = state.userMessages.get(session.activeUserMessageID)
      if (active) return active
    }
    if (session.originUserMessageID) {
      const origin = state.userMessages.get(session.originUserMessageID)
      if (origin) return origin
    }
    return null
  }

  const cleanupSession = (sessionID: string, reason = 'session idle cleanup') => {
    const llm = state.llmCalls.get(sessionID)
    if (llm) {
      endSpan(llm)
      state.llmCalls.delete(sessionID)
    }

    for (const [key, tool] of state.toolCalls.entries()) {
      if (tool.sessionID !== sessionID) continue
      endSpan(tool, { code: SpanStatusCode.ERROR, message: reason })
      state.toolCalls.delete(key)
      const childSessionID = state.taskCallChildren.get(key)
      if (childSessionID) {
        state.childSessionParents.delete(childSessionID)
        state.taskCallChildren.delete(key)
      }
    }

    const messageIDs = state.sessionMessageIDs.get(sessionID)
    if (messageIDs) {
      for (const messageID of messageIDs) {
        const message = state.userMessages.get(messageID)
        if (!message) continue
        endSpan(message)
        state.userMessages.delete(messageID)
      }
      state.sessionMessageIDs.delete(sessionID)
    }

    for (const [key, link] of state.toolLinks.entries()) {
      if (link.sessionID === sessionID) state.toolLinks.delete(key)
    }

    state.promptSnapshots.delete(sessionID)

    const session = state.sessions.get(sessionID)
    if (!session) return
    session.status = 'idle'
    session.originUserMessageID = null
    session.activeUserMessageID = null
    session.pendingActions = []

    state.childSessionParents.delete(sessionID)
    for (const [callID, childSessionID] of state.taskCallChildren.entries()) {
      if (childSessionID === sessionID) state.taskCallChildren.delete(callID)
    }
  }

  const endSession = (sessionID: string, reason = 'session closed') => {
    cleanupSession(sessionID, reason)
    const session = state.sessions.get(sessionID)
    if (!session) return
    endSpan(session.spanEntry)
    state.sessions.delete(sessionID)
  }

  const resolveToolLink = (callID: string) => state.toolLinks.get(callID) || null

  const api = {
    state,
    setConfig(config: Record<string, any>) {
      state.runtimeConfig.userID =
        typeof config?.username === 'string' && config.username.length > 0
          ? config.username
          : undefined
    },
    onChatSystemTransform(input: Record<string, any>, output: Record<string, any>) {
      if (!input?.sessionID || !Array.isArray(output?.system)) return
      const current = state.promptSnapshots.get(input.sessionID) || {}
      state.promptSnapshots.set(input.sessionID, {
        ...current,
        system: output.system.filter((value: unknown): value is string => typeof value === 'string'),
      })
    },
    onChatMessagesTransform(_input: Record<string, any>, output: Record<string, any>) {
      const messages = Array.isArray(output?.messages) ? output.messages : []
      for (const message of messages) {
        const sessionID = message?.info?.sessionID
        if (!sessionID) continue

        const current = state.promptSnapshots.get(sessionID) || {}
        state.promptSnapshots.set(sessionID, {
          ...current,
          messages,
        })
      }
    },
    onChatMessage(input: Record<string, any>, output: Record<string, any>) {
      const session = withSession(input.sessionID, () => api.onChatMessage(input, output))
      if (!session?.spanEntry) return
      const messageID = output?.message?.id
      if (!messageID) return

      const origin = session.originUserMessageID
        ? state.userMessages.get(session.originUserMessageID)
        : null
      const queued = session.status !== 'idle' && Boolean(origin)
      const parentContext = queued && origin ? origin.context : session.spanEntry.context

      const entry = openSpan({
        startSpan,
        name: queued ? 'queued_user_message' : 'user_message',
        parentContext,
        attributes: userMessageAttributes({
          input,
          output,
          queued,
          runtime: getRuntimeMetadata(input.sessionID),
        }),
        extra: {
          messageID,
          sessionID: input.sessionID,
          queued,
        },
      }) as UserMessageEntry

      state.userMessages.set(messageID, entry)
      sessionMessages(input.sessionID).add(messageID)

      if (!queued) session.originUserMessageID = messageID
      session.activeUserMessageID = messageID
    },
    onChatParams(input: Record<string, any>, output: Record<string, any>) {
      const session = withSession(input.sessionID, () => api.onChatParams(input, output))
      if (!session?.spanEntry) return
      const parentMessageID =
        input.message?.id || session.activeUserMessageID || session.originUserMessageID
      if (!parentMessageID) return

      const parentMessage = state.userMessages.get(parentMessageID)
      if (!parentMessage) return

      const active = state.llmCalls.get(input.sessionID)
      if (active) endSpan(active)

      const prompt = state.promptSnapshots.get(input.sessionID)

      const entry = openSpan({
        startSpan,
        name: 'llm_call',
        parentContext: parentMessage.context,
        attributes: llmCallAttributes({
          input,
          output,
          parentMessageID,
          runtime: getRuntimeMetadata(input.sessionID),
          prompt,
        }),
        extra: {
          sessionID: input.sessionID,
          parentMessageID,
          text: '',
          startedAt: Date.now(),
          firstChunkAt: null,
        },
      }) as LlmCallEntry

      state.llmCalls.set(input.sessionID, entry)
    },
    onToolExecuteBefore(input: Record<string, any>, output: Record<string, any>) {
      const session = withSession(input.sessionID, () => api.onToolExecuteBefore(input, output))
      if (!session?.spanEntry) return
      const link = resolveToolLink(input.callID)
      const llm = state.llmCalls.get(input.sessionID)
      const user = link?.messageID
        ? state.userMessages.get(link.messageID)
        : getCurrentUserEntry(session)
      const parentContext = llm?.context || user?.context || session.spanEntry.context

      const entry = openSpan({
        startSpan,
        name: 'tool_call',
        parentContext,
        attributes: toolStartAttributes({
          input,
          output,
          link,
          runtime: getRuntimeMetadata(input.sessionID),
        }),
        extra: {
          sessionID: input.sessionID,
          callID: input.callID,
        },
      }) as ToolEntry

      state.toolCalls.set(input.callID, entry)
      if (link?.partID) state.toolLinks.set(link.partID, link)
    },
    onToolExecuteAfter(input: Record<string, any>, output: Record<string, any>) {
      const session = withSession(input.sessionID, () => api.onToolExecuteAfter(input, output))
      if (!session) return
      const link = resolveToolLink(input.callID)
      const entry =
        state.toolCalls.get(input.callID) ||
        (link?.partID ? state.toolCalls.get(link.partID) : null)
      if (!entry) return

      const childSessionID =
        output?.metadata && typeof output.metadata.sessionId === 'string'
          ? output.metadata.sessionId
          : undefined
      if (childSessionID) resolveChildSessionParent(childSessionID, input.callID)

      setDefinedAttributes(
        entry.span,
        toolFinishAttributes({
          input,
          output,
          link,
          runtime: getRuntimeMetadata(input.sessionID),
        }),
      )
      endSpan(entry)
      state.toolCalls.delete(input.callID)
      if (link?.partID) state.toolCalls.delete(link.partID)
    },
    onEvent(event: RuntimeEvent) {
      if (!event || typeof event !== 'object') return

      if (event.type === 'session.created') {
        const sessionID = event.properties?.info?.id
        if (sessionID) ensureSession(sessionID, event.properties?.info)
        return
      }

      if (event.type === 'session.status') {
        const sessionID = event.properties?.sessionID
        if (!sessionID) return
        const session = withSession(sessionID, () => api.onEvent(event))
        if (!session) return
        const statusType = event.properties?.status?.type
        session.status = statusType || session.status
        if (statusType === 'retry') {
          const llm = state.llmCalls.get(sessionID)
          llm?.span.addEvent('retry', {
            attempt: event.properties?.status?.attempt,
            next: event.properties?.status?.next,
            message: event.properties?.status?.message,
          })
        }
        if (statusType === 'idle') {
          if (session.parentSessionID) endSession(sessionID)
          else cleanupSession(sessionID)
        }
        return
      }

      if (event.type === 'session.deleted') {
        const sessionID = event.properties?.info?.id
        if (sessionID) endSession(sessionID)
        return
      }

      if (event.type === 'message.updated') {
        const info = event.properties?.info
        if (!info || info.role !== 'assistant' || !info.sessionID) return
        const session = withSession(info.sessionID, () => api.onEvent(event))
        if (!session) return
        const llm = state.llmCalls.get(info.sessionID)
        if (!llm) return
        setDefinedAttributes(llm.span, assistantAttributes(info))
        if (info.time?.completed) {
          llm.span.setAttribute('llm.response.ms_to_finish', Date.now() - llm.startedAt)
        }
        return
      }

      if (event.type === 'message.part.delta') {
        const sessionID = event.properties?.sessionID
        const field = event.properties?.field
        const delta = event.properties?.delta
        if (!sessionID || field !== 'text' || typeof delta !== 'string') return
        const session = withSession(sessionID, () => api.onEvent(event))
        if (!session) return
        const llm = state.llmCalls.get(sessionID)
        if (!llm) return
        if (llm.firstChunkAt === null) {
          llm.firstChunkAt = Date.now()
          llm.span.setAttribute('llm.response.ms_to_first_chunk', llm.firstChunkAt - llm.startedAt)
        }
        llm.text += delta
        llm.span.setAttribute('llm.output.preview', llm.text)
        llm.span.setAttribute('llm.output.text', llm.text)
        return
      }

      if (event.type === 'message.part.updated') {
        const part = event.properties?.part
        if (!part || !part.sessionID) return

        const childSessionID =
          part.type === 'tool' && part.state?.metadata && typeof part.state.metadata.sessionId === 'string'
            ? part.state.metadata.sessionId
            : undefined
        if (childSessionID && (part.callID || part.id)) {
          resolveChildSessionParent(childSessionID, part.callID || part.id)
        }

        const session = withSession(part.sessionID, () => api.onEvent(event))
        if (!session) return

        if (part.type === 'tool') {
          const link: ToolLink = {
            sessionID: part.sessionID,
            messageID: part.messageID,
            tool: part.tool,
            partID: part.id,
            childSessionID,
          }
          if (part.callID) state.toolLinks.set(part.callID, link)
          if (part.id) state.toolLinks.set(part.id, { ...link, callID: part.callID || part.id })

          const entry =
            (part.callID && state.toolCalls.get(part.callID)) ||
            state.toolCalls.get(part.id)
          if (entry) {
            setDefinedAttributes(entry.span, {
              'tool.state': part.state?.status,
              'tool.title': part.state?.title,
              'tool.metadata': part.state?.metadata ? JSON.stringify(part.state.metadata) : undefined,
              'tool.output': typeof part.state?.output === 'string' ? part.state.output : undefined,
              'tool.error': part.state?.error ? JSON.stringify(part.state.error) : undefined,
              'tool.child_session_id': childSessionID,
            })
            if (part.state?.status === 'error') {
              setEntryStatus(entry, { code: SpanStatusCode.ERROR, message: 'tool error' })
              endSpan(entry)
            }
            if (part.state?.status === 'completed') endSpan(entry)
          }
          return
        }

        if (part.type === 'step-finish') {
          const llm = state.llmCalls.get(part.sessionID)
          if (!llm) return
          setDefinedAttributes(llm.span, stepFinishAttributes(part))
        }
        return
      }

      if (event.type === 'message.removed') {
        const sessionID = event.properties?.sessionID
        const messageID = event.properties?.messageID
        if (!sessionID || !messageID) return
        const session = withSession(sessionID, () => api.onEvent(event))
        if (!session) return
        const message = state.userMessages.get(messageID)
        if (message) {
          endSpan(message)
          state.userMessages.delete(messageID)
        }
        state.sessionMessageIDs.get(sessionID)?.delete(messageID)
        return
      }

      if (event.type === 'server.instance.disposed') {
        for (const sessionID of [...state.sessions.keys()]) {
          endSession(sessionID, 'server disposed')
        }
      }
    },
    shutdown() {
      for (const sessionID of [...state.sessions.keys()]) {
        endSession(sessionID, 'shutdown')
      }
    },
  }

  return api
}
