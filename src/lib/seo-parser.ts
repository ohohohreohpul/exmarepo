export interface PageSeoData {
  title:          string | null
  metaDescription: string | null
  h1:             string | null
  h2s:            string[]
  canonical:      string | null
  robotsMeta:     string | null
  schemaTypes:    string[]
  wordCount:      number
  internalLinks:  number
  crawlHash:      string
}

export interface DetectedIssue {
  type:        string
  severity:    'critical' | 'warning' | 'info'
  description: string
  recommendation: string
}

function extractTag(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern)
  return m ? m[1]?.trim() ?? null : null
}

export function parsePageSeo(html: string, pageUrl: string): PageSeoData {
  const title          = extractTag(html, /<title[^>]*>([^<]+)<\/title>/i)
  const metaDescription = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? extractTag(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  const h1             = extractTag(html, /<h1[^>]*>([^<]+)<\/h1>/i)
  const h2Matches      = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => m[1].trim())
  const canonical      = extractTag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? extractTag(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)
  const robotsMeta     = extractTag(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)

  const schemaMatches  = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1])
  const schemaTypes    = [...new Set(schemaMatches)]

  const text      = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = text.split(' ').filter(Boolean).length

  const host = new URL(pageUrl).host
  const internalLinkMatches = [...html.matchAll(/href=["']([^"']+)["']/gi)]
  const internalLinks = internalLinkMatches.filter(m => {
    try { return new URL(m[1], pageUrl).host === host } catch { return false }
  }).length

  const crawlHash = Buffer.from(html.slice(0, 2000)).toString('base64').slice(0, 32)

  return { title, metaDescription, h1, h2s: h2Matches, canonical, robotsMeta, schemaTypes, wordCount, internalLinks, crawlHash }
}

export function detectSeoIssues(seo: PageSeoData, _pageUrl: string): DetectedIssue[] {
  const issues: DetectedIssue[] = []

  if (!seo.title) {
    issues.push({ type: 'missing_title', severity: 'critical', description: 'Page has no <title> tag', recommendation: 'Add a descriptive title tag (50–60 characters)' })
  } else if (seo.title.length > 60) {
    issues.push({ type: 'title_too_long', severity: 'warning', description: `Title is ${seo.title.length} chars (max 60)`, recommendation: 'Shorten the title to 60 characters or less' })
  } else if (seo.title.length < 20) {
    issues.push({ type: 'title_too_short', severity: 'warning', description: `Title is only ${seo.title.length} chars`, recommendation: 'Expand the title to at least 20 characters' })
  }

  if (!seo.metaDescription) {
    issues.push({ type: 'missing_meta_description', severity: 'warning', description: 'No meta description found', recommendation: 'Add a meta description (120–160 characters)' })
  } else if (seo.metaDescription.length > 160) {
    issues.push({ type: 'meta_description_too_long', severity: 'info', description: `Meta description is ${seo.metaDescription.length} chars`, recommendation: 'Trim to 160 characters to avoid truncation' })
  }

  if (!seo.h1) {
    issues.push({ type: 'missing_h1', severity: 'critical', description: 'Page has no H1 heading', recommendation: 'Add exactly one H1 that includes the primary keyword' })
  }

  if (seo.wordCount < 300) {
    issues.push({ type: 'thin_content', severity: 'warning', description: `Page has only ${seo.wordCount} words`, recommendation: 'Expand content to at least 300 words' })
  }

  if (seo.robotsMeta?.includes('noindex')) {
    issues.push({ type: 'noindex_page', severity: 'critical', description: 'Page is marked noindex', recommendation: 'Remove noindex directive if this page should be indexed' })
  }

  return issues
}
