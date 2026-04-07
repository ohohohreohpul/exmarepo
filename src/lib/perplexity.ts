export interface GeoQueryResult {
  brandCited:      boolean
  brandPosition:   number | null
  ourUrlCited:     boolean
  citedUrl:        string | null
  citationContext: string | null
  rawResponse:     string
}

export async function queryPerplexity(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set')

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    'sonar',
      messages: [{ role: 'user', content: query }],
      return_citations: true,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) throw new Error(`Perplexity error: ${res.status}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content ?? ''
}

export async function queryOpenRouterGeo(query: string, apiKey: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: query }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`OpenRouter GEO error: ${res.status}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content ?? ''
}

export function detectCitation(
  response: string,
  brandName: string,
  siteUrls: string[]
): GeoQueryResult {
  const lower       = response.toLowerCase()
  const brandLower  = brandName.toLowerCase()
  const brandCited  = lower.includes(brandLower)

  let brandPosition: number | null = null
  if (brandCited) {
    const idx = lower.indexOf(brandLower)
    const before = lower.slice(0, idx)
    brandPosition = (before.match(/\n/g) ?? []).length + 1
  }

  let ourUrlCited = false
  let citedUrl: string | null = null
  for (const url of siteUrls) {
    if (lower.includes(url.replace(/https?:\/\//, '').replace(/\/$/, ''))) {
      ourUrlCited = true
      citedUrl    = url
      break
    }
  }

  let citationContext: string | null = null
  if (brandCited) {
    const idx   = lower.indexOf(brandLower)
    const start = Math.max(0, idx - 100)
    const end   = Math.min(response.length, idx + 200)
    citationContext = response.slice(start, end).trim()
  }

  return { brandCited, brandPosition, ourUrlCited, citedUrl, citationContext, rawResponse: response }
}
