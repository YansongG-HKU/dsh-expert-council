/**
 * Tolerant JSON extraction for model replies.
 *
 * Models sometimes wrap JSON in fences, prepend a sentence, or emit trailing
 * commentary. The executor must never trust a reply blindly, but it also should
 * not throw away a usable answer because of a code fence. Extraction is
 * deliberately conservative: it only returns the first balanced object, then
 * the caller validates the shape.
 */

export function extractJsonObject(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return null
  let source = text.trim()
  // Strip a single fenced block if present.
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) source = fence[1].trim()
  // Fast path.
  try {
    const parsed = JSON.parse(source)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    /* continue with scanner */
  }
  const start = source.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(source.slice(start, i + 1))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Strip fences / prose so a repair prompt can show the model its own answer. */
export function compactForRepair(text, max = 1600) {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n…（截断）` : trimmed
}

export function repairMessages(raw, schemaHint) {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            '你上一条回复不是合法的、符合契约的 JSON。请只输出一个 JSON 对象，不要 markdown 代码块、不要解释。',
            `契约：${schemaHint}`,
            '原始回复（请修正它）：',
            compactForRepair(raw),
          ].join('\n'),
        },
      ],
    },
  ]
}
