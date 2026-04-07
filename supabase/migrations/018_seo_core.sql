-- SEO Core tables: site connections, pages, issues, agent runs

create type if not exists site_connection_type   as enum ('wordpress', 'html');
create type if not exists site_connection_status as enum ('active', 'error', 'disconnected');
create type if not exists page_index_status      as enum ('indexed', 'noindex', 'unknown');
create type if not exists issue_severity         as enum ('critical', 'warning', 'info');
create type if not exists issue_status           as enum ('open', 'resolved', 'ignored');
create type if not exists seo_agent_type         as enum ('auditor', 'keyword_researcher', 'content_optimizer', 'rank_tracker', 'geo_monitor', 'technical_auditor', 'autoblog', 'twitter_engage', 'twitter_analytics', 'content_gap');
create type if not exists seo_agent_run_status   as enum ('running', 'completed', 'failed');
create type if not exists seo_issue_type         as enum ('missing_title','title_too_long','title_too_short','missing_meta_description','meta_description_too_long','missing_h1','thin_content','noindex_page','duplicate_title','duplicate_meta','broken_link','missing_schema','slow_page','missing_canonical');

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
