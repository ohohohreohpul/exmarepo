import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { encrypt } from '@/lib/encryption'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    workspaceId: string
    type: 'wordpress' | 'html'
    displayName: string
    siteUrl: string
    wpUsername?: string
    wpPassword?: string
  }

  const row: Record<string, unknown> = {
    workspace_id: body.workspaceId,
    type:         body.type,
    display_name: body.displayName,
    site_url:     body.siteUrl.replace(/\/$/, ''),
    status:       'active',
  }
  if (body.type === 'wordpress' && body.wpUsername && body.wpPassword) {
    row.wp_username     = body.wpUsername
    row.wp_password_enc = encrypt(body.wpPassword)
  }

  const { data, error } = await admin()
    .from('site_connections')
    .insert(row)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: data })
}
