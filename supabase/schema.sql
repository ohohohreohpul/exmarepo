-- ============================================================
-- SEOGOD — Full Schema (clean install)
-- Run this on a fresh Supabase project.
-- It drops and recreates the public schema entirely.
-- ============================================================

drop schema public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to public;

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
create type platform as enum ('meta', 'google', 'linkedin');
create type funnel_stage as enum ('See', 'Think', 'Do', 'Care');
create type creative_type as enum ('image', 'video', 'carousel');
create type workspace_member_role as enum ('owner', 'admin', 'viewer');

-- ============================================================
-- WORKSPACES  (one per client/team)
-- ============================================================
create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- WORKSPACE MEMBERS  (maps Supabase auth users → workspaces)
-- ============================================================
create table workspace_members (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          workspace_member_role not null default 'viewer',
  created_at    timestamptz not null default now(),
  unique(workspace_id, user_id)
);

-- ============================================================
-- TRACKED BRANDS  (competitors + own brand per workspace)
-- ============================================================
create table tracked_brands (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  name              text not null,
  platform          platform not null,
  platform_page_id  text,           -- Meta page ID / Google advertiser ID etc.
  is_own_brand      boolean not null default false,
  color             text,           -- Hex color for charts e.g. "#E4002B"
  created_at        timestamptz not null default now()
);

-- ============================================================
-- ADS  (raw ingested creatives from all platforms)
-- ============================================================
create table ads (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  brand_id       uuid not null references tracked_brands(id) on delete cascade,
  platform       platform not null,
  ad_id          text not null,     -- Native platform ad ID
  creative_type  creative_type not null default 'image',
  headline       text,
  body           text,
  cta            text,
  thumbnail_url  text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz,
  is_active      boolean not null default true,
  raw_payload    jsonb,             -- Full API response for reference
  created_at     timestamptz not null default now(),
  unique(workspace_id, platform, ad_id)
);

-- ============================================================
-- AD ENRICHMENTS  (AI-generated scores, runs async after ingest)
-- ============================================================
create table ad_enrichments (
  ad_id           uuid primary key references ads(id) on delete cascade,
  sentiment_score numeric(4,3),     -- -1.000 to +1.000
  funnel_stage    funnel_stage,
  topics          text[],           -- e.g. {"price", "loyalty", "sustainability"}
  enriched_at     timestamptz not null default now()
);

-- ============================================================
-- AD SPEND ESTIMATES  (computed weekly per ad)
-- ============================================================
create table ad_spend_estimates (
  id                  uuid primary key default gen_random_uuid(),
  ad_id               uuid not null references ads(id) on delete cascade,
  week_start          date not null,  -- ISO week Monday
  est_impressions     bigint,
  est_reach           bigint,
  est_spend_eur       numeric(12,2),
  estimation_method   text default 'v1', -- version for auditability
  unique(ad_id, week_start)
);

-- ============================================================
-- WEEKLY METRICS  (pre-aggregated for fast dashboard queries)
-- ============================================================
create table weekly_metrics (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references workspaces(id) on delete cascade,
  week_start              date not null,
  brand_id                uuid not null references tracked_brands(id) on delete cascade,
  platform                platform not null,
  total_ads               integer not null default 0,
  new_ads                 integer not null default 0,
  active_ads              integer not null default 0,
  est_spend_eur           numeric(12,2) not null default 0,
  est_reach               bigint not null default 0,
  avg_sentiment           numeric(4,3),
  avg_performance_index   numeric(5,2),  -- 0-100 custom score
  funnel_breakdown        jsonb,         -- {"See": 12, "Think": 8, "Do": 5, "Care": 2}
  unique(workspace_id, week_start, brand_id, platform)
);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table tracked_brands    enable row level security;
alter table ads               enable row level security;
alter table ad_enrichments    enable row level security;
alter table ad_spend_estimates enable row level security;
alter table weekly_metrics    enable row level security;

-- Helper: check if current user is a member of a workspace
create or replace function is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer;

-- Workspaces: members can read their own workspaces
create policy "workspace_select" on workspaces
  for select using (is_workspace_member(id));

-- Workspaces: any authenticated user can create a workspace
create policy "workspace_insert" on workspaces
  for insert with check (auth.uid() is not null);

-- Workspaces: members can update their own workspace
create policy "workspace_update" on workspaces
  for update using (is_workspace_member(id));

-- Workspace members: users see their own memberships
create policy "workspace_members_select" on workspace_members
  for select using (user_id = auth.uid());

-- Workspace members: owners can insert new members
create policy "workspace_members_insert" on workspace_members
  for insert with check (
    exists (
      select 1 from workspace_members
      where workspace_id = workspace_members.workspace_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- Tracked brands, ads, enrichments, estimates, metrics: workspace members only
create policy "tracked_brands_select" on tracked_brands
  for select using (is_workspace_member(workspace_id));

create policy "tracked_brands_insert" on tracked_brands
  for insert with check (is_workspace_member(workspace_id));

create policy "tracked_brands_update" on tracked_brands
  for update using (is_workspace_member(workspace_id));

create policy "ads_select" on ads
  for select using (is_workspace_member(workspace_id));

create policy "ads_insert" on ads
  for insert with check (is_workspace_member(workspace_id));

create policy "ads_update" on ads
  for update using (is_workspace_member(workspace_id));

create policy "ad_enrichments_select" on ad_enrichments
  for select using (
    exists (select 1 from ads where ads.id = ad_enrichments.ad_id and is_workspace_member(ads.workspace_id))
  );

create policy "ad_enrichments_upsert" on ad_enrichments
  for all using (
    exists (select 1 from ads where ads.id = ad_enrichments.ad_id and is_workspace_member(ads.workspace_id))
  );

create policy "ad_spend_estimates_select" on ad_spend_estimates
  for select using (
    exists (select 1 from ads where ads.id = ad_spend_estimates.ad_id and is_workspace_member(ads.workspace_id))
  );

create policy "ad_spend_estimates_upsert" on ad_spend_estimates
  for all using (
    exists (select 1 from ads where ads.id = ad_spend_estimates.ad_id and is_workspace_member(ads.workspace_id))
  );

create policy "weekly_metrics_select" on weekly_metrics
  for select using (is_workspace_member(workspace_id));

create policy "weekly_metrics_upsert" on weekly_metrics
  for all using (is_workspace_member(workspace_id));

-- ============================================================
-- INDEXES  (query performance)
-- ============================================================
create index ads_workspace_brand_idx on ads(workspace_id, brand_id);
create index ads_platform_idx on ads(platform);
create index ads_first_seen_idx on ads(first_seen_at desc);
create index ad_enrichments_funnel_idx on ad_enrichments(funnel_stage);
create index weekly_metrics_week_idx on weekly_metrics(workspace_id, week_start desc);
create index weekly_metrics_brand_idx on weekly_metrics(brand_id);

-- ============================================================
-- FUNCTION: aggregate weekly metrics  (call after each ingest run)
-- ============================================================
create or replace function refresh_weekly_metrics(ws_id uuid, week date)
returns void as $$
begin
  insert into weekly_metrics (
    workspace_id, week_start, brand_id, platform,
    total_ads, new_ads, active_ads,
    est_spend_eur, est_reach,
    avg_sentiment, avg_performance_index,
    funnel_breakdown
  )
  select
    a.workspace_id,
    week,
    a.brand_id,
    a.platform,
    count(*)                                             as total_ads,
    count(*) filter (where a.first_seen_at >= week
                       and a.first_seen_at < week + 7)  as new_ads,
    count(*) filter (where a.is_active)                 as active_ads,
    coalesce(sum(ase.est_spend_eur), 0)                 as est_spend_eur,
    coalesce(sum(ase.est_reach), 0)                     as est_reach,
    avg(ae.sentiment_score)                             as avg_sentiment,
    null                                                as avg_performance_index,
    jsonb_build_object(
      'See',  count(*) filter (where ae.funnel_stage = 'See'),
      'Think', count(*) filter (where ae.funnel_stage = 'Think'),
      'Do',   count(*) filter (where ae.funnel_stage = 'Do'),
      'Care', count(*) filter (where ae.funnel_stage = 'Care')
    )                                                   as funnel_breakdown
  from ads a
  left join ad_enrichments ae on ae.ad_id = a.id
  left join ad_spend_estimates ase on ase.ad_id = a.id and ase.week_start = week
  where a.workspace_id = ws_id
  group by a.workspace_id, a.brand_id, a.platform
  on conflict (workspace_id, week_start, brand_id, platform)
  do update set
    total_ads               = excluded.total_ads,
    new_ads                 = excluded.new_ads,
    active_ads              = excluded.active_ads,
    est_spend_eur           = excluded.est_spend_eur,
    est_reach               = excluded.est_reach,
    avg_sentiment           = excluded.avg_sentiment,
    funnel_breakdown        = excluded.funnel_breakdown;
end;
$$ language plpgsql security definer;
-- ============================================================
-- Migration 002: Snowflake connection config per workspace
-- ============================================================

create table snowflake_connections (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  -- credentials
  account         text not null,
  username        text not null,
  password        text not null,
  role            text,
  warehouse       text not null,
  database        text not null,
  schema          text not null,
  -- column mapping
  table_name      text not null,
  col_brand       text not null,
  col_date        text not null,
  col_headline    text,
  col_spend       text,
  col_impressions text,
  col_reach       text,
  col_pi          text,
  col_funnel      text,
  col_topic       text,
  -- sync metadata
  last_synced_at  timestamptz,
  last_sync_rows  integer,
  sync_status     text not null default 'idle',  -- idle | syncing | error
  sync_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(workspace_id)
);

alter table snowflake_connections enable row level security;

create policy "sf_connections_select" on snowflake_connections
  for select using (is_workspace_member(workspace_id));

create policy "sf_connections_insert" on snowflake_connections
  for insert with check (is_workspace_member(workspace_id));

create policy "sf_connections_update" on snowflake_connections
  for update using (is_workspace_member(workspace_id));

create policy "sf_connections_delete" on snowflake_connections
  for delete using (is_workspace_member(workspace_id));

-- Add performance_index column to ads (Snowflake source may provide this)
alter table ads add column if not exists performance_index numeric(5,2);
alter table ads add column if not exists topic text;
-- Add unique constraint so tracked_brands upserts work correctly
ALTER TABLE tracked_brands
  ADD CONSTRAINT tracked_brands_workspace_name_platform_key
  UNIQUE (workspace_id, name, platform);
-- Add own_brand column to workspaces so users can specify their primary brand name
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS own_brand TEXT;
-- ============================================================
-- Migration 005: Support multiple Snowflake connections per workspace
-- ============================================================

-- Allow multiple connections per workspace (drop the unique constraint)
alter table snowflake_connections drop constraint if exists snowflake_connections_workspace_id_key;

-- Add a human-readable name for each connection (e.g. "Germany", "Poland")
alter table snowflake_connections add column if not exists connection_name text;

-- Tag each ad with which connection it came from so we can filter by source
alter table ads add column if not exists connection_id uuid references snowflake_connections(id) on delete set null;

-- Index for fast filtering
create index if not exists ads_connection_id_idx on ads(connection_id);
-- Alert rules per workspace
create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  condition_type text not null,
  threshold numeric not null default 20,
  brand text,
  enabled boolean not null default true,
  last_triggered_at timestamptz,
  trigger_count integer not null default 0,
  created_at timestamptz default now()
);

-- Triggered alert events
create table if not exists alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  rule_id uuid references alert_rules(id) on delete set null,
  rule_name text not null,
  message text not null,
  severity text not null default 'info',
  read boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists alert_rules_workspace_idx on alert_rules(workspace_id);
create index if not exists alert_events_workspace_idx on alert_events(workspace_id, created_at desc);
-- Workspace intelligence profile — used to give AI context about the client
alter table workspaces
  add column if not exists company_name        text,
  add column if not exists industry            text,
  add column if not exists website             text,
  add column if not exists brand_description   text,
  add column if not exists target_audience     text,
  add column if not exists ai_context          text;
-- ─── Strategy Intelligence ───────────────────────────────────────────────────

-- Agent context stored per workspace (JSON object matching the UI fields)
alter table workspaces
  add column if not exists strategy_context jsonb;

-- Generated strategy briefs (one per agent run)
create table if not exists strategy_briefs (
  id             uuid        primary key default gen_random_uuid(),
  workspace_id   uuid        not null references workspaces(id) on delete cascade,
  week_label     text        not null,
  generated_at   timestamptz not null default now(),
  brief_json     jsonb       not null,
  rec_count      integer     not null default 0
);

create index if not exists strategy_briefs_workspace_time_idx
  on strategy_briefs(workspace_id, generated_at desc);

-- RLS
alter table strategy_briefs enable row level security;

create policy "workspace members can manage strategy briefs"
  on strategy_briefs for all
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = strategy_briefs.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );
-- ─── Ad Platform Connections ─────────────────────────────────────────────────
-- Stores OAuth tokens for Google Ads and Meta Ads per workspace.
-- Each workspace can connect multiple ad accounts (e.g. multiple Meta accounts).

create table if not exists ad_platform_connections (
  id               uuid        primary key default gen_random_uuid(),
  workspace_id     uuid        not null references workspaces(id) on delete cascade,
  platform         text        not null check (platform in ('google_ads', 'meta_ads')),
  account_id       text        not null,  -- Google: customer_id, Meta: act_XXXXX
  account_name     text        not null default '',
  access_token     text        not null,
  refresh_token    text,                  -- Google has refresh; Meta long-lived tokens don't
  token_expires_at timestamptz,
  scopes           text        not null default '',
  connected_at     timestamptz not null default now(),
  last_used_at     timestamptz,
  status           text        not null default 'active' check (status in ('active', 'error', 'revoked')),
  error_message    text,

  unique (workspace_id, platform, account_id)
);

create index if not exists ad_platform_connections_workspace_idx
  on ad_platform_connections(workspace_id, platform);

-- RLS
alter table ad_platform_connections enable row level security;

create policy "workspace members can manage ad platform connections"
  on ad_platform_connections for all
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = ad_platform_connections.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );
-- Agent runs: log every autonomous agent execution
create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  agent_type    text not null default 'competitive_watch',
  status        text not null default 'running',  -- running | completed | failed
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  summary       text,
  findings      jsonb,   -- array of { title, detail, severity: 'high'|'medium'|'low', brand? }
  actions_taken jsonb,   -- array of { type: 'slack'|'email'|'asana'|'notion', status, detail }
  error         text,
  created_at    timestamptz not null default now()
);

-- Agent schedules: per-workspace configuration for the watch agent
create table if not exists agent_schedules (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade unique,
  enabled             boolean not null default false,
  run_day             text not null default 'monday',  -- monday|tuesday|...|sunday|daily
  run_hour            int  not null default 7,          -- 0–23 UTC
  last_run_at         timestamptz,
  slack_webhook_url   text,
  notify_email        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- RLS
alter table agent_runs      enable row level security;
alter table agent_schedules enable row level security;

create policy "workspace members can read agent_runs"
  on agent_runs for select
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = agent_runs.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );

create policy "workspace members can read agent_schedules"
  on agent_schedules for select
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = agent_schedules.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );

create policy "workspace admins can update agent_schedules"
  on agent_schedules for all
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = agent_schedules.workspace_id
        and workspace_members.user_id = auth.uid()
        and workspace_members.role in ('owner', 'admin')
    )
  );

create index if not exists agent_runs_workspace_id_idx on agent_runs(workspace_id);
create index if not exists agent_runs_started_at_idx   on agent_runs(started_at desc);
-- productivity_connections: stores Asana and ClickUp integration credentials
-- Each workspace can have one connection per platform

create table if not exists productivity_connections (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references workspaces(id) on delete cascade,
  platform          text        not null,  -- 'asana' | 'clickup'
  account_name      text,                  -- display name (Asana workspace name, ClickUp user name)
  access_token      text        not null,
  refresh_token     text,                  -- Asana only (OAuth refresh token)
  token_expires_at  timestamptz,           -- Asana only
  config            jsonb       not null default '{}',
  -- Asana config: { workspace_gid, workspace_name, project_gid, project_name }
  -- ClickUp config: { team_id, team_name, space_id, space_name, list_id, list_name }
  status            text        not null default 'active',  -- 'active' | 'error'
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (workspace_id, platform)
);

alter table productivity_connections enable row level security;

-- Workspace members can view connections for their workspace
create policy "workspace members can view productivity connections"
  on productivity_connections for select
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = productivity_connections.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );
create table if not exists dashboard_tiles (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  title        text        not null default 'Untitled chart',
  metric_a     text        not null,
  metric_b     text,
  dimension    text        not null,
  chart_type   text        not null default 'bar',
  filters      jsonb       not null default '{}',
  week_range   int         not null default 4,
  position     int         not null default 0,
  col_span     int         not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table dashboard_tiles enable row level security;

create policy "workspace members can manage dashboard tiles"
  on dashboard_tiles for all
  using (
    exists (
      select 1 from workspace_members
      where workspace_members.workspace_id = dashboard_tiles.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );
-- ============================================================
-- Migration 013: Named dashboards + canvas state
-- ============================================================

-- Multiple named dashboards per workspace
create table if not exists dashboards (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  name         text        not null default 'My Dashboard',
  position     int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table dashboards enable row level security;

create policy "workspace members can manage dashboards"
  on dashboards for all
  using (is_workspace_member(workspace_id));

-- Link existing tiles to a named dashboard
alter table dashboard_tiles
  add column if not exists dashboard_id uuid references dashboards(id) on delete cascade;

-- Canvas state (one saved canvas per workspace for now)
create table if not exists canvas_states (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  nodes        jsonb       not null default '[]',
  edges        jsonb       not null default '[]',
  updated_at   timestamptz not null default now(),
  unique(workspace_id)
);

alter table canvas_states enable row level security;

create policy "workspace members can manage canvas"
  on canvas_states for all
  using (is_workspace_member(workspace_id));
-- Add brand_colors JSONB to workspaces
-- Stores a map of { "BrandName": "#hexcolor" } per workspace
-- e.g. { "ORLEN": "#E4002B", "Aral": "#0066B2", "Shell": "#FBCE07" }
alter table workspaces
  add column if not exists brand_colors jsonb not null default '{}'::jsonb;

-- Add delete policy for tracked_brands (was missing)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'tracked_brands'
      and policyname = 'tracked_brands_delete'
  ) then
    execute 'create policy "tracked_brands_delete" on tracked_brands
      for delete using (is_workspace_member(workspace_id))';
  end if;
end $$;
-- Named canvas saves (multiple snapshots per workspace)
create table if not exists canvas_saves (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces(id) on delete cascade,
  name         text        not null,
  nodes        jsonb       not null default '[]',
  edges        jsonb       not null default '[]',
  created_at   timestamptz not null default now()
);

alter table canvas_saves enable row level security;

create policy "workspace members can manage canvas saves"
  on canvas_saves for all
  using (is_workspace_member(workspace_id));
-- Allow manually-added brands alongside sync-imported ones.
-- 'manual' platform value is used for brands added via Setup page (no real ad platform).

-- Extend the platform enum
alter type platform add value if not exists 'manual';

-- Add source column: 'sync' = auto-imported from data source, 'manual' = user-added
alter table tracked_brands
  add column if not exists source text not null default 'sync'
  check (source in ('sync', 'manual'));
-- Add 'snowflake' as a valid platform value for brands synced from Snowflake connections.
-- Previously these were incorrectly labelled 'meta'.
alter type platform add value if not exists 'snowflake';

-- Migrate any existing rows that were incorrectly tagged as 'meta' but came from sync
-- (source = 'sync' means they were auto-imported, not from a real Meta ads account)
update tracked_brands
  set platform = 'snowflake'
  where platform = 'meta'
    and source = 'sync';
-- SEO Core tables: site connections, pages, issues, agent runs

create type site_connection_type   as enum ('wordpress', 'html');
create type site_connection_status as enum ('active', 'error', 'disconnected');
create type page_index_status      as enum ('indexed', 'noindex', 'unknown');
create type issue_severity         as enum ('critical', 'warning', 'info');
create type issue_status           as enum ('open', 'resolved', 'ignored');
create type seo_agent_type         as enum ('auditor', 'keyword_researcher', 'content_optimizer', 'rank_tracker', 'geo_monitor', 'technical_auditor', 'autoblog', 'twitter_engage', 'twitter_analytics', 'content_gap');
create type seo_agent_run_status   as enum ('running', 'completed', 'failed');
create type seo_issue_type         as enum ('missing_title','title_too_long','title_too_short','missing_meta_description','meta_description_too_long','missing_h1','thin_content','noindex_page','duplicate_title','duplicate_meta','broken_link','missing_schema','slow_page','missing_canonical');

create table if not exists site_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  type           site_connection_type not null,
  display_name   text not null,
  site_url       text not null,
  wp_username    text,
  wp_password_enc text,
  status         site_connection_status not null default 'active',
  last_crawled_at timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists seo_pages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  site_id          uuid not null references site_connections(id) on delete cascade,
  url              text not null,
  title            text,
  meta_description text,
  h1               text,
  h2s              text[],
  canonical        text,
  robots_meta      text,
  schema_types     text[],
  word_count       int,
  internal_links   int,
  index_status     page_index_status not null default 'unknown',
  crawl_hash       text,
  last_crawled_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique(site_id, url)
);

create table if not exists seo_issues (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  site_id      uuid not null references site_connections(id) on delete cascade,
  page_id      uuid references seo_pages(id) on delete cascade,
  issue_type   seo_issue_type not null,
  severity     issue_severity not null,
  status       issue_status not null default 'open',
  description  text,
  recommendation text,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists seo_agent_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_type   seo_agent_type not null,
  status       seo_agent_run_status not null default 'running',
  summary      text,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- RLS
alter table site_connections enable row level security;
alter table seo_pages        enable row level security;
alter table seo_issues       enable row level security;
alter table seo_agent_runs   enable row level security;

create policy "workspace members" on site_connections for all using (is_workspace_member(workspace_id));
create policy "workspace members" on seo_pages        for all using (is_workspace_member(workspace_id));
create policy "workspace members" on seo_issues       for all using (is_workspace_member(workspace_id));
create policy "workspace members" on seo_agent_runs   for all using (is_workspace_member(workspace_id));
-- Keyword tracking + clusters

create table if not exists keywords (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  keyword       text not null,
  country_code  text not null default 'us',
  search_volume int,
  difficulty    int,
  cpc_usd       numeric(8,2),
  intent        text,
  trend_data    jsonb,
  created_at    timestamptz not null default now(),
  unique(workspace_id, keyword, country_code)
);

create table if not exists keyword_rankings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  keyword_id   uuid not null references keywords(id) on delete cascade,
  site_id      uuid references site_connections(id) on delete set null,
  position     int,
  url          text,
  checked_at   timestamptz not null default now()
);

create table if not exists keyword_clusters (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now()
);

create table if not exists keyword_cluster_items (
  cluster_id  uuid not null references keyword_clusters(id) on delete cascade,
  keyword_id  uuid not null references keywords(id) on delete cascade,
  primary key (cluster_id, keyword_id)
);

alter table keywords           enable row level security;
alter table keyword_rankings   enable row level security;
alter table keyword_clusters   enable row level security;
alter table keyword_cluster_items enable row level security;

create policy "workspace members" on keywords             for all using (is_workspace_member(workspace_id));
create policy "workspace members" on keyword_rankings     for all using (is_workspace_member(workspace_id));
create policy "workspace members" on keyword_clusters     for all using (is_workspace_member(workspace_id));
create policy "workspace members" on keyword_cluster_items for all
  using (exists (select 1 from keyword_clusters kc where kc.id = cluster_id and is_workspace_member(kc.workspace_id)));
-- Content gap analysis: competitor sites, pages, gaps

create table if not exists competitor_sites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  site_url     text not null,
  display_name text not null,
  last_crawled_at timestamptz,
  created_at   timestamptz not null default now(),
  unique(workspace_id, site_url)
);

create table if not exists competitor_pages (
  id            uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitor_sites(id) on delete cascade,
  url           text not null,
  title         text,
  word_count    int,
  h1            text,
  crawled_at    timestamptz not null default now(),
  unique(competitor_id, url)
);

create table if not exists content_gaps (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  topic           text not null,
  opportunity_score int,
  target_keywords text[],
  suggested_title text,
  suggested_outline jsonb,
  competitor_examples jsonb,
  blog_draft_id   uuid,
  created_at      timestamptz not null default now()
);

alter table competitor_sites  enable row level security;
alter table competitor_pages  enable row level security;
alter table content_gaps      enable row level security;

create policy "workspace members" on competitor_sites for all using (is_workspace_member(workspace_id));
create policy "workspace members" on content_gaps     for all using (is_workspace_member(workspace_id));
create policy "workspace members" on competitor_pages for all
  using (exists (select 1 from competitor_sites cs where cs.id = competitor_id and is_workspace_member(cs.workspace_id)));
-- GEO (Generative Engine Optimization) — AI visibility tracking

create type geo_engine as enum ('perplexity', 'chatgpt', 'google_ai_overview', 'bing_copilot');

create table if not exists geo_queries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  query_text   text not null,
  engine       geo_engine not null default 'perplexity',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists geo_results (
  id              uuid primary key default gen_random_uuid(),
  query_id        uuid not null references geo_queries(id) on delete cascade,
  brand_cited     boolean not null default false,
  brand_position  int,
  our_url_cited   boolean not null default false,
  cited_url       text,
  citation_context text,
  raw_response    text,
  checked_at      timestamptz not null default now()
);

create table if not exists geo_improvement_suggestions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  suggestion   text not null,
  priority     issue_severity not null default 'info',
  implemented  boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table geo_queries                 enable row level security;
alter table geo_results                 enable row level security;
alter table geo_improvement_suggestions enable row level security;

create policy "workspace members" on geo_queries                 for all using (is_workspace_member(workspace_id));
create policy "workspace members" on geo_improvement_suggestions for all using (is_workspace_member(workspace_id));
create policy "workspace members" on geo_results for all
  using (exists (select 1 from geo_queries gq where gq.id = query_id and is_workspace_member(gq.workspace_id)));
-- Auto blogging: RSS feeds, items, generated drafts

create type blog_draft_status as enum ('generating','draft','approved','publishing','published','failed','dismissed');

create table if not exists rss_feeds (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  feed_url     text not null,
  display_name text,
  active       boolean not null default true,
  last_fetched_at timestamptz,
  created_at   timestamptz not null default now(),
  unique(workspace_id, feed_url)
);

create table if not exists rss_items (
  id           uuid primary key default gen_random_uuid(),
  feed_id      uuid not null references rss_feeds(id) on delete cascade,
  guid         text not null,
  title        text,
  url          text,
  summary      text,
  full_content text,
  author       text,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique(feed_id, guid)
);

create table if not exists blog_drafts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  site_id           uuid references site_connections(id) on delete set null,
  rss_item_id       uuid references rss_items(id) on delete set null,
  content_gap_id    uuid references content_gaps(id) on delete set null,
  status            blog_draft_status not null default 'draft',
  title             text,
  slug              text,
  meta_description  text,
  content_markdown  text,
  content_html      text,
  schema_faq        jsonb,
  h_structure       jsonb,
  word_count        int,
  target_keywords   text[],
  wp_post_id        int,
  published_url     text,
  error_message     text,
  approved_at       timestamptz,
  published_at      timestamptz,
  created_at        timestamptz not null default now()
);

alter table rss_feeds   enable row level security;
alter table rss_items   enable row level security;
alter table blog_drafts enable row level security;

create policy "workspace members" on rss_feeds   for all using (is_workspace_member(workspace_id));
create policy "workspace members" on blog_drafts for all using (is_workspace_member(workspace_id));
create policy "workspace members" on rss_items for all
  using (exists (select 1 from rss_feeds rf where rf.id = feed_id and is_workspace_member(rf.workspace_id)));
-- X/Twitter agentic bot system

create table if not exists twitter_connections (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  twitter_user_id     text not null,
  twitter_username    text not null,
  access_token_enc    text not null,
  refresh_token_enc   text,
  token_expires_at    timestamptz,
  pagination_cursor   text,
  connected_at        timestamptz not null default now(),
  unique(workspace_id)
);

create table if not exists twitter_bot_configs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  persona_prompt    text,
  voice_examples    text[],
  topics            text[],
  affiliate_links   jsonb,
  daily_quote_limit int not null default 5,
  engagement_threshold_likes int not null default 10,
  engagement_threshold_replies int not null default 3,
  autopilot_enabled boolean not null default false,
  updated_at        timestamptz not null default now(),
  unique(workspace_id)
);

create table if not exists twitter_feed_tweets (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  tweet_id        text not null,
  author_username text,
  content         text,
  ai_score        int,
  ai_reason       text,
  fetched_at      timestamptz not null default now(),
  unique(workspace_id, tweet_id)
);

create table if not exists twitter_actions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  source_tweet_id   text not null,
  source_username   text,
  source_content    text,
  quote_tweet_id    text,
  quote_content     text,
  likes_count       int not null default 0,
  replies_count     int not null default 0,
  retweets_count    int not null default 0,
  affiliate_replied boolean not null default false,
  affiliate_tweet_id text,
  affiliate_link    text,
  posted_at         timestamptz not null default now()
);

create table if not exists twitter_agent_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_type   text not null,
  status       seo_agent_run_status not null default 'running',
  summary      text,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table twitter_connections  enable row level security;
alter table twitter_bot_configs  enable row level security;
alter table twitter_feed_tweets  enable row level security;
alter table twitter_actions      enable row level security;
alter table twitter_agent_runs   enable row level security;

create policy "workspace members" on twitter_connections for all using (is_workspace_member(workspace_id));
create policy "workspace members" on twitter_bot_configs for all using (is_workspace_member(workspace_id));
create policy "workspace members" on twitter_feed_tweets for all using (is_workspace_member(workspace_id));
create policy "workspace members" on twitter_actions     for all using (is_workspace_member(workspace_id));
create policy "workspace members" on twitter_agent_runs  for all using (is_workspace_member(workspace_id));

-- ============================================================
-- Role grants (required after schema reset)
-- ============================================================
grant usage  on schema public to anon, authenticated;
grant all    on all tables    in schema public to anon, authenticated;
grant all    on all sequences in schema public to anon, authenticated;
grant all    on all routines  in schema public to anon, authenticated;
