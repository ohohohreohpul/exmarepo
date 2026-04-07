import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/encryption'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET — check if connected
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  const { data } = await admin()
    .from('twitter_connections')
    .select('twitter_username, token_expires_at, connected_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  return NextResponse.json({ connection: data ?? null })
}

// POST — save OAuth tokens (called from OAuth callback)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId, twitterUserId, twitterUsername, accessToken, refreshToken, expiresAt } = await req.json() as {
    workspaceId: string
    twitterUserId: string
    twitterUsername: string
    accessToken: string
    refreshToken?: string
    expiresAt?: string
  }

  const { error } = await admin()
    .from('twitter_connections')
    .upsert({
      workspace_id:       workspaceId,
      twitter_user_id:    twitterUserId,
      twitter_username:   twitterUsername,
      access_token_enc:   encrypt(accessToken),
      refresh_token_enc:  refreshToken ? encrypt(refreshToken) : null,
      token_expires_at:   expiresAt ?? null,
    }, { onConflict: 'workspace_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — disconnect
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId } = await req.json() as { workspaceId: string }
  const { error } = await admin().from('twitter_connections').delete().eq('workspace_id', workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Helper used by agent routes
export async function getTwitterTokens(workspaceId: string): Promise<{ accessToken: string; username: string } | null> {
  const { data } = await admin()
    .from('twitter_connections')
    .select('access_token_enc, refresh_token_enc, token_expires_at, twitter_username')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!data) return null

  const now = new Date()
  const expires = data.token_expires_at ? new Date(data.token_expires_at as string) : null
  if (expires && now >= expires && data.refresh_token_enc) {
    const refreshed = await refreshTwitterToken(data.refresh_token_enc as string, workspaceId)
    if (refreshed) return { accessToken: refreshed, username: data.twitter_username as string }
  }

  return {
    accessToken: decrypt(data.access_token_enc as string),
    username:    data.twitter_username as string,
  }
}

async function refreshTwitterToken(refreshTokenEnc: string, workspaceId: string): Promise<string | null> {
  try {
    const refreshToken = decrypt(refreshTokenEnc)
    const creds = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64')
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined
    const d = admin() as ReturnType<typeof createAdmin>
    await (d as unknown as { from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (col: string, val: string) => unknown } } })
      .from('twitter_connections')
      .update({
        access_token_enc:  encrypt(data.access_token),
        refresh_token_enc: data.refresh_token ? encrypt(data.refresh_token) : undefined,
        token_expires_at:  expiresAt,
      })
      .eq('workspace_id', workspaceId)
    return data.access_token
  } catch {
    return null
  }
}
