export interface KeywordEstimate {
  keyword:     string
  volume:      number
  difficulty:  number
  cpcUsd:      number
  intent:      string
  trendData:   number[]
}

export function buildKeywordResearchPrompt(topic: string, existingKeywords: string[]): string {
  return `You are an SEO keyword research expert.

Topic: "${topic}"
Already tracked: ${existingKeywords.length > 0 ? existingKeywords.join(', ') : 'none'}

Generate 20-30 keyword suggestions. Return ONLY valid JSON array:
[
  { "keyword": "...", "intent": "informational|navigational|transactional|commercial" },
  ...
]

Include: head terms, long-tail variants, question keywords (what/how/why/best), comparison terms.
Do NOT include already-tracked keywords.`
}

export function buildKeywordEstimationPrompt(keywords: string[]): string {
  return `Estimate SEO metrics for these keywords. Return ONLY valid JSON array matching exact input order:
[
  { "keyword": "...", "volume": 1200, "difficulty": 45, "cpcUsd": 1.20, "intent": "informational" },
  ...
]

Keywords: ${keywords.map(k => `"${k}"`).join(', ')}

Rules:
- volume: monthly searches (0–500000)
- difficulty: 0–100 (0=easy, 100=impossible)
- cpcUsd: cost per click in USD
- intent: informational | navigational | transactional | commercial`
}

export function parseKeywordEstimations(raw: string): KeywordEstimate[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0]) as Array<{
      keyword: string; volume?: number; difficulty?: number; cpcUsd?: number; intent?: string
    }>
    return parsed.map(k => ({
      keyword:    k.keyword,
      volume:     k.volume    ?? 0,
      difficulty: k.difficulty ?? 50,
      cpcUsd:     k.cpcUsd    ?? 0,
      intent:     k.intent    ?? 'informational',
      trendData:  generateMockTrend(k.volume ?? 0),
    }))
  } catch {
    return []
  }
}

export function classifySearchIntent(keyword: string): string {
  const k = keyword.toLowerCase()
  if (/^(buy|order|purchase|cheap|price|deal|discount|shop|get|hire)/.test(k)) return 'transactional'
  if (/(vs|versus|compare|best|review|top|alternative)/.test(k)) return 'commercial'
  if (/^(how|what|why|when|where|who|which|can|does|is|are)/.test(k)) return 'informational'
  return 'informational'
}

export function generateMockTrend(baseVolume: number): number[] {
  const months = 12
  return Array.from({ length: months }, (_, i) => {
    const seasonal = 1 + 0.2 * Math.sin((i / months) * 2 * Math.PI)
    const noise    = 0.85 + Math.random() * 0.3
    return Math.max(0, Math.round(baseVolume * seasonal * noise))
  })
}
