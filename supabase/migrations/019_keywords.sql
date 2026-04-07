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
