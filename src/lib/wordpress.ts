export interface WpPost {
  id: number
  link: string
  title: string
  content: string
  excerpt: string
  status: string
  yoast_head_json?: {
    title?: string
    description?: string
    og_description?: string
  }
  rank_math_title?: string
  rank_math_description?: string
}

export async function testWpConnection(
  siteUrl: string,
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = siteUrl.replace(/\/$/, '')
    const creds = Buffer.from(`${username}:${password}`).toString('base64')
    const res = await fetch(`${base}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${creds}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function fetchWpContent(
  siteUrl: string,
  username: string,
  password: string
): Promise<WpPost[]> {
  const base  = siteUrl.replace(/\/$/, '')
  const creds = Buffer.from(`${username}:${password}`).toString('base64')
  const headers = { Authorization: `Basic ${creds}` }

  const [posts, pages] = await Promise.all([
    fetch(`${base}/wp-json/wp/v2/posts?per_page=100&_fields=id,link,title,content,excerpt,status,yoast_head_json`, { headers }).then(r => r.ok ? r.json() : []),
    fetch(`${base}/wp-json/wp/v2/pages?per_page=100&_fields=id,link,title,content,excerpt,status,yoast_head_json`, { headers }).then(r => r.ok ? r.json() : []),
  ])

  return [...(Array.isArray(posts) ? posts : []), ...(Array.isArray(pages) ? pages : [])]
}

export function extractTitle(post: WpPost): string {
  return post.yoast_head_json?.title
    ?? post.rank_math_title
    ?? (typeof post.title === 'object' ? (post.title as { rendered?: string }).rendered : post.title)
    ?? ''
}

export function extractMetaDescription(post: WpPost): string {
  return post.yoast_head_json?.description
    ?? post.yoast_head_json?.og_description
    ?? post.rank_math_description
    ?? (typeof post.excerpt === 'object' ? (post.excerpt as { rendered?: string }).rendered : post.excerpt)
    ?? ''
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function publishToWordPress(
  siteUrl: string,
  username: string,
  password: string,
  post: {
    title: string
    content: string
    slug: string
    status?: 'publish' | 'draft'
    metaDescription?: string
  }
): Promise<{ ok: boolean; postId?: number; url?: string; error?: string }> {
  try {
    const base  = siteUrl.replace(/\/$/, '')
    const creds = Buffer.from(`${username}:${password}`).toString('base64')
    const body: Record<string, unknown> = {
      title:   post.title,
      content: post.content,
      slug:    post.slug,
      status:  post.status ?? 'publish',
    }
    if (post.metaDescription) {
      body.meta = { _yoast_wpseo_metadesc: post.metaDescription }
    }
    const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method:  'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: err }
    }
    const data = await res.json() as { id: number; link: string }
    return { ok: true, postId: data.id, url: data.link }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
