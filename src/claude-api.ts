// ═══════════════════════════════════════════════════════════════
// Shared Claude API caller for all deliverable engines
// Handles retries, rate limits, timeout, JSON parsing
// ═══════════════════════════════════════════════════════════════

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

/** Content block for multimodal messages (text, image, document) */
export interface ClaudeContentBlock {
  type: 'text' | 'image' | 'document'
  text?: string
  source?: {
    type: 'base64'
    media_type: string  // 'application/pdf', 'image/png', etc.
    data: string        // base64-encoded file data
  }
}

export interface ClaudeCallOptions {
  apiKey: string
  systemPrompt: string
  userPrompt: string
  /** Optional: multimodal content blocks (documents, images + text) */
  userContent?: ClaudeContentBlock[]
  maxTokens?: number
  timeoutMs?: number
  maxRetries?: number
  label?: string  // for logging, e.g. "BMC Deliverable", "SIC Deliverable"
  temperature?: number  // 0.0-1.0, default undefined (API default)
}

/**
 * Call Claude API with retries, rate limit handling, timeout, JSON parsing.
 * Returns parsed JSON or throws an error.
 */
export async function callClaudeJSON<T = any>(opts: ClaudeCallOptions): Promise<T> {
  const {
    apiKey,
    systemPrompt,
    userPrompt,
    maxTokens = 8192,
    timeoutMs = 90_000,
    maxRetries = 2,
    label = 'Deliverable'
  } = opts

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      console.log(`[${label}] Claude API call attempt ${attempt}/${maxRetries}`)
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          system: systemPrompt,
          messages: [{ role: 'user', content: opts.userContent || userPrompt }]
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Rate limit — exponential backoff
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10)
        const waitMs = Math.max((retryAfter || 8) * 1000, attempt * 10000)
        console.log(`[${label}] Rate limited (429), waiting ${waitMs / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitMs))
        continue
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error')
        throw new Error(`Claude API error ${response.status}: ${errorBody.slice(0, 300)}`)
      }

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>
        error?: { message?: string }
      }

      if (data.error) {
        throw new Error(`Claude API returned error: ${data.error.message || JSON.stringify(data.error)}`)
      }

      const textBlock = data.content?.find(c => c.type === 'text')
      if (!textBlock?.text) throw new Error('Claude returned empty response')

      // Parse JSON — handle markdown wrapping
      let jsonText = textBlock.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
      }

      try {
        return JSON.parse(jsonText) as T
      } catch {
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as T
        }
        throw new Error(`Failed to parse Claude JSON: ${jsonText.slice(0, 200)}`)
      }

    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        if (attempt < maxRetries) {
          console.log(`[${label}] Timeout on attempt ${attempt}, retrying...`)
          continue
        }
        throw new Error(`${label}: Claude API timeout after ${maxRetries} attempts`)
      }
      if (attempt >= maxRetries) throw err
      console.log(`[${label}] Attempt ${attempt} failed: ${err.message}, retrying...`)
      await new Promise(resolve => setTimeout(resolve, attempt * 4000))
    }
  }
  throw new Error(`${label}: Claude API failed after all retries`)
}

/** Shared KB context type for all deliverable engines */
export interface KBContext {
  benchmarks: string
  fiscalParams: string
  funders: string
  criteria: string
  feedback: string
}

/** Check if an API key is valid (not placeholder, not too short) */
export function isValidApiKey(apiKey?: string): boolean {
  return !!apiKey && apiKey !== 'sk-ant-PLACEHOLDER' && apiKey.length >= 20
}
