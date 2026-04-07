export interface RssItem {
  guid:        string
  title:       string
  url:         string
  summary:     string
  fullContent: string
  author:      string
  publishedAt: string | null
}

export interface RssFeed {
  title: string
  items: RssItem[]
}

function decodeCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function extractField(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeCdata(m[1]).trim() : ''
}

function parseRss(xml: string): RssFeed {
  const titleMatch = xml.match(/<channel>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
  const feedTitle  = titleMatch ? decodeCdata(titleMatch[1]) : 'RSS Feed'

  const items: RssItem[] = []
  const itemMatches = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)]
  for (const m of itemMatches) {
    const chunk = m[1]
    items.push({
      guid:        extractField(chunk, 'guid') || extractField(chunk, 'link'),
      title:       extractField(chunk, 'title'),
      url:         extractField(chunk, 'link'),
      summary:     extractField(chunk, 'description'),
      fullContent: extractField(chunk, 'content:encoded') || extractField(chunk, 'description'),
      author:      extractField(chunk, 'dc:creator') || extractField(chunk, 'author'),
      publishedAt: extractField(chunk, 'pubDate') || null,
    })
  }
  return { title: feedTitle, items }
}

function parseAtom(xml: string): RssFeed {
  const titleMatch = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
  const feedTitle  = titleMatch ? decodeCdata(titleMatch[1]) : 'Atom Feed'

  const items: RssItem[] = []
  const entryMatches = [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)]
  for (const m of entryMatches) {
    const chunk = m[1]
    const linkMatch = chunk.match(/<link[^>]+href=["']([^"']+)["']/)
    items.push({
      guid:        extractField(chunk, 'id'),
      title:       extractField(chunk, 'title'),
      url:         linkMatch?.[1] ?? '',
      summary:     extractField(chunk, 'summary'),
      fullContent: extractField(chunk, 'content') || extractField(chunk, 'summary'),
      author:      extractField(chunk, 'name'),
      publishedAt: extractField(chunk, 'published') || extractField(chunk, 'updated') || null,
    })
  }
  return { title: feedTitle, items }
}

export async function fetchRssFeed(feedUrl: string): Promise<RssFeed> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'SEOGOD/1.0 (+https://seogod.io)' },
    signal:  AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${feedUrl}`)
  const xml = await res.text()
  return xml.includes('<feed') ? parseAtom(xml) : parseRss(xml)
}
