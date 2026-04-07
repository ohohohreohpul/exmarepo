-- Auto blogging: RSS feeds, items, generated drafts

create type if not exists blog_draft_status as enum ('generating','draft','approved','publishing','published','failed','dismissed');

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
