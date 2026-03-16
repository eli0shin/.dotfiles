import { describe, expect, test } from 'bun:test'

import { createTracingLifecycle } from '../lib/opencode-otel/state.ts'

const createFakeSpanFactory = () => {
  const spans: any[] = []

  const startSpan = ({
    name,
    parentContext,
    attributes,
  }: {
    name: string
    parentContext?: { span?: { id?: string } }
    attributes?: Record<string, unknown>
  }) => {
    const span = {
      name,
      attributes: { ...(attributes || {}) },
      parentSpanID: parentContext?.span?.id || null,
      ended: false,
      status: null,
      events: [] as any[],
      exceptions: [] as any[],
      output: undefined,
      setAttribute(key: string, value: unknown) {
        this.attributes[key] = value
      },
      addEvent(name: string, attributes?: Record<string, unknown>) {
        this.events.push({ name, attributes })
      },
      recordException(error: unknown) {
        this.exceptions.push(error)
      },
      setStatus(status: unknown) {
        this.status = status
      },
      end() {
        this.ended = true
      },
    }

    span.id = `${name}-${spans.length + 1}`
    const context = { span }
    spans.push(span)
    return { span, context }
  }

  return { spans, startSpan }
}

const createUserOutput = (id: string, text: string, sessionID = 'session-1') => ({
  message: {
    id,
    sessionID,
    role: 'user',
    time: { created: '2026-03-14T00:00:00.000Z' },
  },
  parts: [{ type: 'text', text }],
})

describe('createTracingLifecycle', () => {
  test('nests llm and tool spans under the active user message', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: {
        info: { id: 'session-1', title: 'Demo session', directory: '/tmp/demo' },
      },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Build this feature'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude', name: 'Claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.2, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onToolExecuteBefore(
      { tool: 'bash', sessionID: 'session-1', callID: 'call-1' },
      { args: { command: 'pwd' } },
    )
    lifecycle.onToolExecuteAfter(
      { tool: 'bash', sessionID: 'session-1', callID: 'call-1', args: { command: 'pwd' } },
      { title: 'pwd', output: '/tmp/demo', metadata: { exitCode: 0 } },
    )

    expect(factory.spans.map((span) => span.name)).toEqual([
      'session',
      'user_message',
      'llm_call',
      'tool_call',
    ])
    expect(factory.spans[1].parentSpanID).toBe(factory.spans[0].id)
    expect(factory.spans[2].parentSpanID).toBe(factory.spans[1].id)
    expect(factory.spans[3].parentSpanID).toBe(factory.spans[2].id)
    expect(factory.spans[3].attributes['tool.output']).toBe('/tmp/demo')
    expect(factory.spans[3].ended).toBe(true)
  })

  test('queues later user messages under the origin user span and attaches the next llm call to the queued message', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Demo session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'First request'),
    )
    lifecycle.onEvent({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    })
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.1, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-2', 'Queued follow-up'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-2' },
      },
      { temperature: 0.1, topP: 1, topK: 0, options: {} },
    )

    const queuedUser = factory.spans.find((span) => span.name === 'queued_user_message')
    const llmSpans = factory.spans.filter((span) => span.name === 'llm_call')

    expect(queuedUser.parentSpanID).toBe(factory.spans[1].id)
    expect(queuedUser.attributes['message.queued']).toBe(true)
    expect(llmSpans).toHaveLength(2)
    expect(llmSpans[0].ended).toBe(true)
    expect(llmSpans[1].parentSpanID).toBe(queuedUser.id)
  })

  test('cleans up open spans when the session returns to idle', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Cleanup session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Do work'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.4, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onToolExecuteBefore(
      { tool: 'bash', sessionID: 'session-1', callID: 'call-1' },
      { args: { command: 'sleep 1' } },
    )

    lifecycle.onEvent({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'idle' } },
    })

    expect(factory.spans.filter((span) => !span.ended)).toHaveLength(1)
    expect(factory.spans[1].ended).toBe(true)
    expect(factory.spans[2].ended).toBe(true)
    expect(factory.spans[3].ended).toBe(true)
    expect(factory.spans[3].status?.message).toBe('session idle cleanup')
  })

  test('parents spawned subagent sessions under the task tool span', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Parent session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Delegate this task'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.2, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onToolExecuteBefore(
      { tool: 'task', sessionID: 'session-1', callID: 'task-call-1' },
      { args: { description: 'Run subagent' } },
    )
    lifecycle.onEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          type: 'tool',
          tool: 'task',
          callID: 'task-call-1',
          state: {
            status: 'running',
            metadata: { sessionId: 'subagent-1' },
          },
        },
      },
    })
    lifecycle.onEvent({
      type: 'session.created',
      properties: {
        info: { id: 'subagent-1', parentID: 'session-1', title: 'Subagent session' },
      },
    })
    lifecycle.onChatMessage(
      { sessionID: 'subagent-1', agent: 'explore', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('sub-user-1', 'Subagent prompt', 'subagent-1'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'subagent-1',
        agent: 'explore',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'sub-user-1' },
      },
      { temperature: 0.1, topP: 1, topK: 0, options: {} },
    )

    const taskTool = factory.spans.find((span) => span.name === 'tool_call')
    const childSession = factory.spans.find(
      (span) => span.name === 'session' && span.attributes['session.id'] === 'subagent-1',
    )
    const childUser = factory.spans.find(
      (span) => span.name === 'user_message' && span.attributes['message.id'] === 'sub-user-1',
    )
    const childLlm = factory.spans.filter((span) => span.name === 'llm_call').at(-1)

    expect(taskTool.attributes['tool.name']).toBe('task')
    expect(childSession.parentSpanID).toBe(taskTool.id)
    expect(childSession.attributes['session.parent_tool_call_id']).toBe('task-call-1')
    expect(childUser.parentSpanID).toBe(childSession.id)
    expect(childLlm.parentSpanID).toBe(childUser.id)
  })

  test('buffers child session activity until task tool metadata reveals the child session id', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Parent session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Delegate later'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.2, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onToolExecuteBefore(
      { tool: 'task', sessionID: 'session-1', callID: 'task-call-1' },
      { args: { description: 'Run subagent' } },
    )
    lifecycle.onEvent({
      type: 'session.created',
      properties: {
        info: { id: 'subagent-1', parentID: 'session-1', title: 'Subagent session' },
      },
    })
    lifecycle.onChatMessage(
      { sessionID: 'subagent-1', agent: 'explore', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('sub-user-1', 'Subagent prompt', 'subagent-1'),
    )
    lifecycle.onEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          type: 'tool',
          tool: 'task',
          callID: 'task-call-1',
          state: {
            status: 'running',
            metadata: { sessionId: 'subagent-1' },
          },
        },
      },
    })

    const childSession = factory.spans.find(
      (span) => span.name === 'session' && span.attributes['session.id'] === 'subagent-1',
    )
    const childUser = factory.spans.find(
      (span) => span.name === 'user_message' && span.attributes['message.id'] === 'sub-user-1',
    )

    expect(childSession).toBeDefined()
    expect(childUser).toBeDefined()
    expect(childUser.parentSpanID).toBe(childSession.id)
  })

  test('ends child subagent session spans when the child session goes idle', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Parent session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Delegate this task'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.2, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onToolExecuteBefore(
      { tool: 'task', sessionID: 'session-1', callID: 'task-call-1' },
      { args: { description: 'Run subagent' } },
    )
    lifecycle.onEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          sessionID: 'session-1',
          messageID: 'assistant-1',
          type: 'tool',
          tool: 'task',
          callID: 'task-call-1',
          state: {
            status: 'running',
            metadata: { sessionId: 'subagent-1' },
          },
        },
      },
    })
    lifecycle.onEvent({
      type: 'session.created',
      properties: {
        info: { id: 'subagent-1', parentID: 'session-1', title: 'Subagent session' },
      },
    })
    lifecycle.onChatMessage(
      { sessionID: 'subagent-1', agent: 'explore', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('sub-user-1', 'Subagent prompt', 'subagent-1'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'subagent-1',
        agent: 'explore',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'sub-user-1' },
      },
      { temperature: 0.1, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onEvent({
      type: 'session.status',
      properties: { sessionID: 'subagent-1', status: { type: 'idle' } },
    })

    const parentSession = factory.spans.find(
      (span) => span.name === 'session' && span.attributes['session.id'] === 'session-1',
    )
    const childSession = factory.spans.find(
      (span) => span.name === 'session' && span.attributes['session.id'] === 'subagent-1',
    )
    const childUser = factory.spans.find(
      (span) => span.name === 'user_message' && span.attributes['message.id'] === 'sub-user-1',
    )
    const childLlm = factory.spans.find(
      (span) => span.name === 'llm_call' && span.attributes['message.id'] === 'sub-user-1',
    )

    expect(parentSession.ended).toBe(false)
    expect(childSession.ended).toBe(true)
    expect(childUser.ended).toBe(true)
    expect(childLlm.ended).toBe(true)
  })

  test('ends the top-level session span on shutdown so it can be exported', () => {
    const factory = createFakeSpanFactory()
    const lifecycle = createTracingLifecycle({ startSpan: factory.startSpan as any })

    lifecycle.onEvent({
      type: 'session.created',
      properties: { info: { id: 'session-1', title: 'Root session' } },
    })
    lifecycle.onChatMessage(
      { sessionID: 'session-1', agent: 'build', model: { providerID: 'anthropic', modelID: 'claude' } },
      createUserOutput('user-1', 'Do work'),
    )
    lifecycle.onChatParams(
      {
        sessionID: 'session-1',
        agent: 'build',
        model: { id: 'claude' },
        provider: { id: 'anthropic' },
        message: { id: 'user-1' },
      },
      { temperature: 0.1, topP: 1, topK: 0, options: {} },
    )
    lifecycle.onEvent({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'idle' } },
    })

    const sessionSpan = factory.spans.find(
      (span) => span.name === 'session' && span.attributes['session.id'] === 'session-1',
    )

    expect(sessionSpan.ended).toBe(false)

    lifecycle.shutdown()

    expect(sessionSpan.ended).toBe(true)
  })
})
