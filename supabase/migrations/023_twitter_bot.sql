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
