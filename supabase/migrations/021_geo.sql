-- GEO (Generative Engine Optimization) — AI visibility tracking

create type if not exists geo_engine as enum ('perplexity', 'chatgpt', 'google_ai_overview', 'bing_copilot');

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
