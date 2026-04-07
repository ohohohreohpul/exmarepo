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
