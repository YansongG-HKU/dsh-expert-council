/**
 * Minimal LLM bridge for the Host side of Expert Council.
 *
 * A "real" panel means the Host itself calls the model once per expert, in
 * parallel, instead of asking the calling agent to role-play five experts in
 * one answer. This module wraps the Harness `llm` service: it resolves the
 * provider/model route, streams one completion, and returns the text plus the
 * provider-reported token usage. Failures are typed so the executor can decide
 * between retry, marking an expert absent, or failing the whole run.
 */

export class LlmUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LlmUnavailableError'
    this.code = 'LLM_UNAVAILABLE'
  }
}

export class LlmCallError extends Error {
  constructor(message, { code = 'LLM_CALL_FAILED', aborted = false, cause = null } = {}) {
    super(message)
    this.name = 'LlmCallError'
    this.code = code
    this.aborted = aborted
    this.cause = cause
  }
}

/** Resolve the model route: explicit args > configured default > undefined. */
export function resolveSelection({ selection = null, provider = null, model = null, reasoningEffort = null } = {}) {
  const base = selection && typeof selection === 'object' ? selection : {}
  const resolvedProvider = provider || base.provider
  const resolvedModel = model || base.model
  if (!resolvedProvider || !resolvedModel) {
    throw new LlmUnavailableError(
      '没有可用的模型路由：真实会诊需要 Host 侧的 llm 服务与默认模型。先在 DSH 里选择默认模型，或在 run 参数里传 provider/model。',
    )
  }
  return {
    provider: String(resolvedProvider),
    model: String(resolvedModel),
    reasoningEffort: reasoningEffort || base.reasoningEffort || undefined,
  }
}

/** Whether the Host can actually run expert calls. */
export function llmAvailable(llm) {
  return Boolean(llm && typeof llm.stream === 'function')
}

function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const input = Math.max(0, Number(usage.inputTokens) || 0)
  const output = Math.max(0, Number(usage.outputTokens) || 0)
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: Number(usage.totalTokens) || input + output,
    cacheReadTokens: Number(usage.cacheReadTokens) || 0,
    reasoningTokens: Number(usage.reasoningTokens) || 0,
  }
}

/** One prepareCall attempt, tolerating adapters that do not take an effort knob. */
async function prepareSafely(llm, config, signal) {
  try {
    return await llm.prepareCall(config, signal ?? undefined)
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw new LlmCallError('调用已取消', { code: 'ABORTED', aborted: true })
    const effortRejected = /reasoning effort|UNSUPPORTED_REASONING_EFFORT/i.test(String(error?.message ?? ''))
    if (!effortRejected) {
      throw new LlmCallError(`模型路由不可用：${error?.message ?? error}`, { code: 'LLM_PREPARE_FAILED', cause: error })
    }
    const { reasoningEffort: _dropped, ...withoutEffort } = config
    try {
      return await llm.prepareCall(withoutEffort, signal ?? undefined)
    } catch (retryError) {
      if (retryError?.name === 'AbortError' || signal?.aborted) throw new LlmCallError('调用已取消', { code: 'ABORTED', aborted: true })
      throw new LlmCallError(`模型路由不可用：${retryError?.message ?? retryError}`, { code: 'LLM_PREPARE_FAILED', cause: retryError })
    }
  }
}

/**
 * One streaming completion, collected into a single string.
 *
 * Reasoning models can spend the whole output budget on hidden reasoning and
 * return no visible text. When that is exactly what happened (finish=max-tokens,
 * no text) we retry once with a larger output budget and lower reasoning effort,
 * which is what a human operator would do — rather than declaring the expert
 * failed on the first try.
 *
 * @returns {Promise<{text:string, usage:object, finish:object|null, provider:string, model:string, latencyMs:number}>}
 */
export async function completeText({
  llm,
  selection = null,
  provider = null,
  model = null,
  reasoningEffort = null,
  system = '',
  messages = [],
  maxTokens = 800,
  temperature = 0.6,
  signal = null,
  sessionId = null,
  purpose = 'expert-council',
  onDelta = null,
} = {}) {
  if (!llmAvailable(llm)) {
    throw new LlmUnavailableError('Host 没有可用的 llm 服务，无法执行真实专家会诊；可先用 lens 模式生成简报。')
  }
  const route = resolveSelection({ selection, provider, model, reasoningEffort })
  const startedAt = Date.now()
  let effectiveMax = Math.max(64, Math.trunc(maxTokens))
  let effectiveEffort = route.reasoningEffort || null
  let lastEmptyReason = ''

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const callConfig = {
      provider: route.provider,
      model: route.model,
      maxTokens: effectiveMax,
      temperature,
      ...(effectiveEffort ? { reasoningEffort: effectiveEffort } : {}),
    }
    const prepared = typeof llm.prepareCall === 'function' ? await prepareSafely(llm, callConfig, signal) : null
    // The prepared handle binds one adapter registration and compares the
    // dispatch options against the resolved config, so start from
    // `prepared.config` (which includes adapter defaults) instead of rebuilding
    // the controls by hand.
    const base = prepared?.config ?? callConfig
    const options = {
      ...base,
      provider: route.provider,
      model: route.model,
      messages,
      maxTokens: effectiveMax,
      temperature,
      purpose,
      ...(system ? { system } : {}),
      ...(signal ? { signal } : {}),
      ...(sessionId ? { sessionId } : {}),
    }
    let text = ''
    let usage = usageOf(null)
    let finish = null
    const stream = prepared ? prepared.stream(options) : llm.stream(options)
    try {
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          onDelta?.(chunk.text)
        } else if (chunk.type === 'usage') {
          usage = usageOf(chunk.usage)
        } else if (chunk.type === 'finish') {
          finish = chunk.reason ?? null
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        throw new LlmCallError('调用已取消', { code: 'ABORTED', aborted: true, cause: error })
      }
      throw new LlmCallError(`模型调用失败：${error?.message ?? error}`, { code: 'LLM_STREAM_FAILED', cause: error })
    }
    if (finish && finish.kind === 'aborted') {
      throw new LlmCallError(finish.failure?.message || '模型调用被中止', { code: 'ABORTED', aborted: true })
    }
    if (finish && finish.kind === 'error') {
      throw new LlmCallError(finish.failure?.message || '模型返回错误', { code: 'LLM_FINISH_ERROR' })
    }
    const trimmed = text.trim()
    if (trimmed) {
      return {
        text: trimmed,
        usage,
        finish,
        provider: route.provider,
        model: route.model,
        latencyMs: Date.now() - startedAt,
        maxTokens: effectiveMax,
        attempt,
      }
    }
    lastEmptyReason = finish?.kind === 'max-tokens' ? '输出额度全部被推理占用' : '模型没有返回可见文本'
    if (attempt === 1 && finish?.kind === 'max-tokens') {
      effectiveMax = Math.min(8192, Math.max(2400, effectiveMax * 2))
      effectiveEffort = 'low'
      continue
    }
    throw new LlmCallError(
      `模型未输出可见文本（${lastEmptyReason}）；已尝试 ${attempt} 次，最后一次 maxTokens=${effectiveMax}。可调低推理强度或换非推理模型。`,
      { code: 'LLM_EMPTY' },
    )
  }
  throw new LlmCallError(`模型未输出可见文本（${lastEmptyReason}）`, { code: 'LLM_EMPTY' })
}
