const textPart = (part: unknown): string => {
  if (!part || typeof part !== 'object') return ''
  if ('text' in part && typeof part.text === 'string') return part.text
  if ('content' in part && typeof part.content === 'string') return part.content
  return ''
}

export const joinMessageText = (parts: unknown): string =>
  Array.isArray(parts) ? parts.map(textPart).filter(Boolean).join('\n') : ''

export const jsonValue = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type RuntimeMetadata = {
  sessionID?: string
  userID?: string
}

type PromptSnapshot = {
  messages?: Array<Record<string, unknown>>
  system?: string[]
}

export const sessionAttributes = (info: Record<string, unknown> = {}) => ({
  'session.id': info.id,
  'session.title': info.title,
  'session.directory': info.directory,
  'project.id': info.projectID,
  'session.slug': info.slug,
  'session.version': info.version,
  'session.parent_id': info.parentID,
  'session.parent_tool_call_id': info.parentToolCallID,
})

export const userMessageAttributes = ({
  input,
  output,
  queued,
  runtime,
}: {
  input: Record<string, any>
  output: Record<string, any>
  queued: boolean
  runtime?: RuntimeMetadata
}) => ({
  'session.id': runtime?.sessionID,
  'user.id': runtime?.userID,
  'message.id': output?.message?.id,
  'message.role': output?.message?.role,
  'message.content': joinMessageText(output?.parts),
  'message.agent': input?.agent,
  'message.model.provider': input?.model?.providerID,
  'message.model.id': input?.model?.modelID,
  'message.queued': queued,
})

export const llmCallAttributes = ({
  input,
  output,
  parentMessageID,
  runtime,
  prompt,
}: {
  input: Record<string, any>
  output: Record<string, any>
  parentMessageID: string
  runtime?: RuntimeMetadata
  prompt?: PromptSnapshot
}) => ({
  'session.id': runtime?.sessionID,
  'user.id': runtime?.userID,
  'message.id': parentMessageID,
  'llm.agent': input?.agent,
  'llm.model.id': input?.model?.id,
  'llm.model.name': input?.model?.name,
  'llm.model.provider': input?.provider?.id,
  'llm.model.api': input?.model?.api?.id,
  'llm.temperature': output?.temperature,
  'llm.top_p': output?.topP,
  'llm.top_k': output?.topK,
  'llm.options': jsonValue(output?.options),
  'llm.prompt.messages': jsonValue(prompt?.messages),
  'llm.prompt.system': jsonValue(prompt?.system),
})

export const assistantAttributes = (info: Record<string, any> = {}) => ({
  'session.id': info.sessionID,
  'assistant.message.id': info.id,
  'assistant.parent_id': info.parentID,
  'assistant.model.id': info.modelID,
  'assistant.provider.id': info.providerID,
  'assistant.agent': info.agent,
  'assistant.mode': info.mode,
  'assistant.variant': info.variant,
  'assistant.path.cwd': info.path?.cwd,
  'assistant.path.root': info.path?.root,
  'assistant.time.created': info.time?.created,
  'assistant.time.completed': info.time?.completed,
  'assistant.finish_reason': info.finish,
  'assistant.cost': info.cost,
  'assistant.error': jsonValue(info.error),
  'assistant.tokens.input': info.tokens?.input,
  'assistant.tokens.output': info.tokens?.output,
  'assistant.tokens.reasoning': info.tokens?.reasoning,
  'assistant.tokens.cache.read': info.tokens?.cache?.read,
  'assistant.tokens.cache.write': info.tokens?.cache?.write,
})

export const stepFinishAttributes = (part: Record<string, any> = {}) => ({
  'llm.step.id': part.id,
  'llm.finish_reason': part.reason,
  'llm.cost': part.cost,
  'llm.tokens.input': part.tokens?.input,
  'llm.tokens.output': part.tokens?.output,
  'llm.tokens.reasoning': part.tokens?.reasoning,
  'llm.tokens.cache.read': part.tokens?.cache?.read,
  'llm.tokens.cache.write': part.tokens?.cache?.write,
})

export const toolStartAttributes = ({
  input,
  output,
  link,
  runtime,
}: {
  input: Record<string, any>
  output: Record<string, any>
  link: Record<string, any> | null
  runtime?: RuntimeMetadata
}) => ({
  'session.id': runtime?.sessionID,
  'user.id': runtime?.userID,
  'tool.name': input?.tool || link?.tool,
  'tool.call_id': input?.callID,
  'tool.input': jsonValue(output?.args),
  'tool.message_id': link?.messageID,
})

export const toolFinishAttributes = ({
  input,
  output,
  link,
  runtime,
}: {
  input: Record<string, any>
  output: Record<string, any>
  link: Record<string, any> | null
  runtime?: RuntimeMetadata
}) => ({
  'session.id': runtime?.sessionID,
  'user.id': runtime?.userID,
  'tool.name': input?.tool || link?.tool,
  'tool.call_id': input?.callID,
  'tool.input': jsonValue(input?.args),
  'tool.output': jsonValue(output?.output),
  'tool.title': output?.title,
  'tool.metadata': jsonValue(output?.metadata),
  'tool.message_id': link?.messageID,
})
