import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  const { data } = await admin()
    .from('twitter_bot_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  return NextResponse.json({ config: data ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    workspaceId: string
    personaPrompt?: string
    voiceExamples?: string[]
    topics?: string[]
    affiliateLinks?: Record<string, string>
    dailyQuoteLimit?: number
    engagementThresholdLikes?: number
    engagementThresholdReplies?: number
    autopilotEnabled?: boolean
  }

  const { error } = await admin()
    .from('twitter_bot_configs')
    .upsert({
      workspace_id:                  body.workspaceId,
      persona_prompt:                body.personaPrompt,
      voice_examples:                body.voiceExamples,
      topics:                        body.topics,
      affiliate_links:               body.affiliateLinks,
      daily_quote_limit:             body.dailyQuoteLimit             ?? 5,
      engagement_threshold_likes:    body.engagementThresholdLikes    ?? 10,
      engagement_threshold_replies:  body.engagementThresholdReplies  ?? 3,
      autopilot_enabled:             body.autopilotEnabled            ?? false,
      updated_at:                    new Date().toISOString(),
    }, { onConflict: 'workspace_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
