-- Kitakana Elo tracker for Supabase
-- Run after supabase/schema.sql in the Supabase SQL Editor.

create table if not exists public.kitakana_elo_trackers (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  rating_scale double precision not null default 225,
  maximum_result_value double precision not null default 5,
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitakana_elo_teams (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  code text not null default '',
  continent text not null default '',
  starting_elo double precision not null,
  baseline_elo double precision not null,
  current_elo double precision not null,
  current_rank integer,
  last_updated_by text not null default 'Starting Elo',
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, name)
);

create unique index if not exists kitakana_elo_teams_owner_name_key
  on public.kitakana_elo_teams (owner_user_id, lower(btrim(name)));

create table if not exists public.kitakana_elo_bonuses (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  bonus_id bigint not null,
  bonus_order bigint not null,
  team_name text not null,
  category text not null default '',
  points double precision not null,
  event text not null default '',
  is_imported boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, bonus_id),
  foreign key (owner_user_id, team_name)
    references public.kitakana_elo_teams(owner_user_id, name)
    on update cascade on delete cascade
);

create index if not exists kitakana_elo_bonuses_owner_order_idx
  on public.kitakana_elo_bonuses (owner_user_id, bonus_order, bonus_id);

create table if not exists public.kitakana_elo_matches (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  match_code text not null,
  match_order bigint not null,
  source_match_id text,
  is_imported boolean not null default false,
  team_a text not null,
  team_b text not null,
  website_team_a text,
  website_team_b text,
  winner text not null check (winner in ('Team A', 'Team B', 'Tie')),
  result_type text not null check (result_type in ('Hoshin-Tora', 'Hoshin-Kai', 'Hoshin-Renga', 'Renga')),
  tier text not null check (tier in ('Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5')),
  score_a double precision,
  score_b double precision,
  score_text text,
  event text not null default '',
  notes text not null default '',
  team_a_pre_elo double precision,
  team_b_pre_elo double precision,
  expected_a double precision,
  expected_b double precision,
  result_value double precision,
  multiplier double precision,
  actual_a double precision,
  actual_b double precision,
  team_a_delta double precision,
  team_b_delta double precision,
  team_a_post_elo double precision,
  team_b_post_elo double precision,
  validation text not null default 'Pending',
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, match_code),
  unique (owner_user_id, match_order),
  foreign key (owner_user_id, team_a)
    references public.kitakana_elo_teams(owner_user_id, name)
    on update cascade on delete restrict,
  foreign key (owner_user_id, team_b)
    references public.kitakana_elo_teams(owner_user_id, name)
    on update cascade on delete restrict,
  check (team_a <> team_b)
);

create index if not exists kitakana_elo_matches_owner_order_idx
  on public.kitakana_elo_matches (owner_user_id, match_order desc);

alter table public.kitakana_elo_trackers enable row level security;
alter table public.kitakana_elo_teams enable row level security;
alter table public.kitakana_elo_bonuses enable row level security;
alter table public.kitakana_elo_matches enable row level security;

drop policy if exists "Users can read own Kitakana tracker" on public.kitakana_elo_trackers;
drop policy if exists "Users can read own Kitakana teams" on public.kitakana_elo_teams;
drop policy if exists "Users can read own Kitakana bonuses" on public.kitakana_elo_bonuses;
drop policy if exists "Users can read own Kitakana matches" on public.kitakana_elo_matches;

create policy "Users can read own Kitakana tracker"
on public.kitakana_elo_trackers for select to authenticated
using (auth.uid() = owner_user_id);

create policy "Users can read own Kitakana teams"
on public.kitakana_elo_teams for select to authenticated
using (auth.uid() = owner_user_id);

create policy "Users can read own Kitakana bonuses"
on public.kitakana_elo_bonuses for select to authenticated
using (auth.uid() = owner_user_id);

create policy "Users can read own Kitakana matches"
on public.kitakana_elo_matches for select to authenticated
using (auth.uid() = owner_user_id);

revoke all on public.kitakana_elo_trackers from anon, authenticated;
revoke all on public.kitakana_elo_teams from anon, authenticated;
revoke all on public.kitakana_elo_bonuses from anon, authenticated;
revoke all on public.kitakana_elo_matches from anon, authenticated;
grant select on public.kitakana_elo_trackers to authenticated;
grant select on public.kitakana_elo_teams to authenticated;
grant select on public.kitakana_elo_bonuses to authenticated;
grant select on public.kitakana_elo_matches to authenticated;

create or replace function public.kitakana_resolve_team_internal(
  p_owner uuid,
  p_name text,
  p_region text default ''
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select team.name
  from public.kitakana_elo_teams team
  where team.owner_user_id = p_owner
    and lower(btrim(team.name)) in (
      lower(btrim(coalesce(p_name, ''))),
      lower(btrim(coalesce(p_region, '')))
    )
  order by case when lower(btrim(team.name)) = lower(btrim(coalesce(p_name, ''))) then 0 else 1 end
  limit 1;
$$;

create or replace function public.kitakana_recalculate_internal(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  match_row public.kitakana_elo_matches%rowtype;
  v_rating_scale double precision;
  v_max_result double precision;
  v_pre_a double precision;
  v_pre_b double precision;
  v_result_value double precision;
  v_multiplier double precision;
  v_expected_a double precision;
  v_expected_b double precision;
  v_actual_a double precision;
  v_actual_b double precision;
  v_delta_a double precision;
  v_delta_b double precision;
begin
  select rating_scale, maximum_result_value
  into v_rating_scale, v_max_result
  from public.kitakana_elo_trackers
  where owner_user_id = p_owner;

  update public.kitakana_elo_teams
  set current_elo = baseline_elo,
      updated_at = now()
  where owner_user_id = p_owner;

  for match_row in
    select *
    from public.kitakana_elo_matches
    where owner_user_id = p_owner and not is_imported
    order by match_order
  loop
    select team.baseline_elo
      + coalesce((
          select sum(bonus.points)
          from public.kitakana_elo_bonuses bonus
          where bonus.owner_user_id = p_owner
            and not bonus.is_imported
            and bonus.team_name = team.name
            and bonus.bonus_order <= match_row.match_order
        ), 0)
      + coalesce((
          select sum(case when previous.team_a = team.name then previous.team_a_delta else previous.team_b_delta end)
          from public.kitakana_elo_matches previous
          where previous.owner_user_id = p_owner
            and not previous.is_imported
            and previous.match_order < match_row.match_order
            and previous.validation = 'OK'
            and team.name in (previous.team_a, previous.team_b)
        ), 0)
    into v_pre_a
    from public.kitakana_elo_teams team
    where team.owner_user_id = p_owner and team.name = match_row.team_a;

    select team.baseline_elo
      + coalesce((
          select sum(bonus.points)
          from public.kitakana_elo_bonuses bonus
          where bonus.owner_user_id = p_owner
            and not bonus.is_imported
            and bonus.team_name = team.name
            and bonus.bonus_order <= match_row.match_order
        ), 0)
      + coalesce((
          select sum(case when previous.team_a = team.name then previous.team_a_delta else previous.team_b_delta end)
          from public.kitakana_elo_matches previous
          where previous.owner_user_id = p_owner
            and not previous.is_imported
            and previous.match_order < match_row.match_order
            and previous.validation = 'OK'
            and team.name in (previous.team_a, previous.team_b)
        ), 0)
    into v_pre_b
    from public.kitakana_elo_teams team
    where team.owner_user_id = p_owner and team.name = match_row.team_b;

    v_result_value := case match_row.result_type
      when 'Hoshin-Tora' then 5
      when 'Hoshin-Kai' then 3
      when 'Hoshin-Renga' then 1.5
      else 0
    end;
    v_multiplier := case match_row.tier
      when 'Tier 1' then 10
      when 'Tier 2' then 7
      when 'Tier 3' then 5
      when 'Tier 4' then 4
      else 2
    end;
    v_expected_a := 1 / (1 + power(10.0, (v_pre_b - v_pre_a) / v_rating_scale));
    v_expected_b := 1 - v_expected_a;
    v_actual_a := case
      when match_row.winner = 'Tie' then 0.5
      when match_row.winner = 'Team A' then (v_result_value + v_max_result) / (2 * v_max_result)
      else (-v_result_value + v_max_result) / (2 * v_max_result)
    end;
    v_actual_b := 1 - v_actual_a;
    v_delta_a := (2 * v_max_result) * v_multiplier * (v_actual_a - v_expected_a);
    v_delta_b := -v_delta_a;

    update public.kitakana_elo_matches
    set team_a_pre_elo = v_pre_a,
        team_b_pre_elo = v_pre_b,
        expected_a = v_expected_a,
        expected_b = v_expected_b,
        result_value = v_result_value,
        multiplier = v_multiplier,
        actual_a = v_actual_a,
        actual_b = v_actual_b,
        team_a_delta = v_delta_a,
        team_b_delta = v_delta_b,
        team_a_post_elo = v_pre_a + v_delta_a,
        team_b_post_elo = v_pre_b + v_delta_b,
        validation = 'OK',
        updated_at = now()
    where owner_user_id = p_owner and match_code = match_row.match_code;
  end loop;

  update public.kitakana_elo_teams team
  set current_elo = team.baseline_elo
      + coalesce((
          select sum(bonus.points)
          from public.kitakana_elo_bonuses bonus
          where bonus.owner_user_id = p_owner
            and not bonus.is_imported
            and bonus.team_name = team.name
        ), 0)
      + coalesce((
          select sum(case when match.team_a = team.name then match.team_a_delta else match.team_b_delta end)
          from public.kitakana_elo_matches match
          where match.owner_user_id = p_owner
            and not match.is_imported
            and match.validation = 'OK'
            and team.name in (match.team_a, match.team_b)
        ), 0),
      last_updated_by = case
        when exists (
          select 1 from public.kitakana_elo_matches match
          where match.owner_user_id = p_owner
            and not match.is_imported
            and team.name in (match.team_a, match.team_b)
        ) then 'Supabase match'
        else team.last_updated_by
      end,
      updated_at = now()
  where team.owner_user_id = p_owner;

  with ranked as (
    select owner_user_id, name,
      rank() over (partition by owner_user_id order by current_elo desc) as current_rank
    from public.kitakana_elo_teams
    where owner_user_id = p_owner
  )
  update public.kitakana_elo_teams team
  set current_rank = ranked.current_rank::integer
  from ranked
  where team.owner_user_id = ranked.owner_user_id and team.name = ranked.name;

  update public.kitakana_elo_trackers
  set updated_at = now()
  where owner_user_id = p_owner;
end;
$$;

create or replace function public.kitakana_elo_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;
  return jsonb_build_object(
    'initialized', exists(select 1 from public.kitakana_elo_teams where owner_user_id = v_owner),
    'backend', 'Supabase',
    'teams', (select count(*) from public.kitakana_elo_teams where owner_user_id = v_owner),
    'bonuses', (select count(*) from public.kitakana_elo_bonuses where owner_user_id = v_owner),
    'matches', (select count(*) from public.kitakana_elo_matches where owner_user_id = v_owner)
  );
end;
$$;

create or replace function public.kitakana_import_seed(p_seed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;
  if p_seed->>'schema' <> 'kitakana-elo-seed' or (p_seed->>'version')::integer <> 1 then
    raise exception 'Unsupported Kitakana Elo seed';
  end if;

  insert into public.kitakana_elo_trackers (
    owner_user_id, rating_scale, maximum_result_value, initialized_at
  ) values (
    v_owner,
    (p_seed->'settings'->>'rating_scale')::double precision,
    (p_seed->'settings'->>'maximum_result_value')::double precision,
    now()
  )
  on conflict (owner_user_id) do nothing;

  if exists(select 1 from public.kitakana_elo_teams where owner_user_id = v_owner) then
    return public.kitakana_elo_status();
  end if;

  insert into public.kitakana_elo_teams (
    owner_user_id, name, code, continent, starting_elo, baseline_elo, current_elo, last_updated_by
  )
  select
    v_owner,
    seed_team.name,
    coalesce(seed_team.code, ''),
    coalesce(seed_team.continent, ''),
    seed_team.starting_elo,
    seed_team.expected_current_elo,
    seed_team.expected_current_elo,
    'Excel baseline'
  from jsonb_to_recordset(p_seed->'teams') as seed_team(
    name text,
    code text,
    continent text,
    starting_elo double precision,
    expected_current_elo double precision
  );

  insert into public.kitakana_elo_bonuses (
    owner_user_id, bonus_id, bonus_order, team_name, category, points, event, is_imported
  )
  select
    v_owner,
    seed_bonus.bonus_id,
    seed_bonus.bonus_order,
    seed_bonus.team,
    coalesce(seed_bonus.category, ''),
    seed_bonus.points,
    coalesce(seed_bonus.event, ''),
    true
  from jsonb_to_recordset(p_seed->'bonuses') as seed_bonus(
    bonus_id bigint,
    bonus_order bigint,
    team text,
    category text,
    points double precision,
    event text
  );

  insert into public.kitakana_elo_matches (
    owner_user_id, match_code, match_order, source_match_id, is_imported,
    team_a, team_b, winner, result_type, tier, event, notes,
    team_a_pre_elo, team_b_pre_elo, expected_a, expected_b,
    result_value, multiplier, actual_a, actual_b,
    team_a_delta, team_b_delta, team_a_post_elo, team_b_post_elo,
    validation
  )
  select
    v_owner,
    seed_match.match_code,
    seed_match.match_order,
    seed_match.source_match_id,
    true,
    seed_match.team_a,
    seed_match.team_b,
    seed_match.winner,
    seed_match.result_type,
    seed_match.tier,
    coalesce(seed_match.event, ''),
    coalesce(seed_match.notes, ''),
    (seed_match.expected->>'team_a_pre_elo')::double precision,
    (seed_match.expected->>'team_b_pre_elo')::double precision,
    (seed_match.expected->>'expected_a')::double precision,
    (seed_match.expected->>'expected_b')::double precision,
    (seed_match.expected->>'result_value')::double precision,
    (seed_match.expected->>'multiplier')::double precision,
    (seed_match.expected->>'actual_a')::double precision,
    (seed_match.expected->>'actual_b')::double precision,
    (seed_match.expected->>'team_a_delta')::double precision,
    (seed_match.expected->>'team_b_delta')::double precision,
    (seed_match.expected->>'team_a_post_elo')::double precision,
    (seed_match.expected->>'team_b_post_elo')::double precision,
    'OK'
  from jsonb_to_recordset(p_seed->'matches') as seed_match(
    match_code text,
    match_order bigint,
    source_match_id text,
    team_a text,
    team_b text,
    winner text,
    result_type text,
    tier text,
    event text,
    notes text,
    expected jsonb
  );

  with ranked as (
    select owner_user_id, name,
      rank() over (partition by owner_user_id order by current_elo desc) as current_rank
    from public.kitakana_elo_teams
    where owner_user_id = v_owner
  )
  update public.kitakana_elo_teams team
  set current_rank = ranked.current_rank::integer
  from ranked
  where team.owner_user_id = ranked.owner_user_id and team.name = ranked.name;

  update public.kitakana_elo_trackers
  set initialized_at = now(), updated_at = now()
  where owner_user_id = v_owner;

  return public.kitakana_elo_status();
end;
$$;

create or replace function public.kitakana_side_context_internal(p_owner uuid, p_team text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_info jsonb;
  v_history jsonb;
begin
  if p_team is null then
    return jsonb_build_object('trackerName', null, 'info', null, 'history', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'name', team.name,
    'code', team.code,
    'continent', team.continent,
    'startingElo', team.starting_elo,
    'currentElo', team.current_elo,
    'currentRank', team.current_rank,
    'updatedBy', team.last_updated_by
  )
  into v_info
  from public.kitakana_elo_teams team
  where team.owner_user_id = p_owner and team.name = p_team;

  select coalesce(jsonb_agg(history.item order by history.match_order desc), '[]'::jsonb)
  into v_history
  from (
    select match.match_order, jsonb_build_object(
      'matchId', coalesce(match.source_match_id, match.match_order::text),
      'opponent', case when match.team_a = p_team then match.team_b else match.team_a end,
      'result', match.result_type,
      'eloChange', case when match.team_a = p_team then match.team_a_delta else match.team_b_delta end,
      'event', match.event,
      'score', match.score_text,
      'updatedAt', match.updated_at
    ) as item
    from public.kitakana_elo_matches match
    where match.owner_user_id = p_owner
      and match.validation = 'OK'
      and p_team in (match.team_a, match.team_b)
    order by match.match_order desc
    limit 5
  ) history;

  return jsonb_build_object('trackerName', p_team, 'info', v_info, 'history', v_history);
end;
$$;

create or replace function public.kitakana_elo_context(
  p_team_a text,
  p_team_a_region text default '',
  p_team_b text default '',
  p_team_b_region text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_team_a text;
  v_team_b text;
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;
  if not exists(select 1 from public.kitakana_elo_teams where owner_user_id = v_owner) then
    return jsonb_build_object('initialized', false, 'backend', 'Supabase');
  end if;

  v_team_a := public.kitakana_resolve_team_internal(v_owner, p_team_a, p_team_a_region);
  v_team_b := public.kitakana_resolve_team_internal(v_owner, p_team_b, p_team_b_region);
  return jsonb_build_object(
    'initialized', true,
    'backend', 'Supabase',
    'sides', jsonb_build_object(
      'teamA', public.kitakana_side_context_internal(v_owner, v_team_a),
      'teamB', public.kitakana_side_context_internal(v_owner, v_team_b)
    )
  );
end;
$$;

create or replace function public.kitakana_submit_matches(p_matches jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  item jsonb;
  v_code text;
  v_team_a text;
  v_team_b text;
  v_winner text;
  v_result_type text;
  v_tier text;
  v_order bigint;
  v_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_updated_at timestamptz;
begin
  if v_owner is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) = 0 then
    raise exception 'No matches supplied';
  end if;
  if not exists(select 1 from public.kitakana_elo_teams where owner_user_id = v_owner) then
    raise exception 'Kitakana Elo tracker is not initialized';
  end if;

  perform 1
  from public.kitakana_elo_trackers
  where owner_user_id = v_owner
  for update;

  for item in select value from jsonb_array_elements(p_matches)
  loop
    v_code := btrim(coalesce(item->>'matchCode', ''));
    if v_code = '' then raise exception 'Match code is required'; end if;

    v_team_a := public.kitakana_resolve_team_internal(
      v_owner, item->>'teamA', coalesce(item->>'teamARegion', '')
    );
    v_team_b := public.kitakana_resolve_team_internal(
      v_owner, item->>'teamB', coalesce(item->>'teamBRegion', '')
    );
    if v_team_a is null then
      raise exception 'Team not found in tracker: %', item->>'teamA';
    end if;
    if v_team_b is null then
      raise exception 'Team not found in tracker: %', item->>'teamB';
    end if;
    if v_team_a = v_team_b then
      raise exception 'Both website teams resolve to the same Elo tracker team';
    end if;

    v_winner := case when item->>'winner' in ('Tie', 'Renga') then 'Tie' else item->>'winner' end;
    v_result_type := item->>'resultType';
    v_tier := item->>'tier';
    if v_winner not in ('Team A', 'Team B', 'Tie') then raise exception 'Invalid winner'; end if;
    if v_result_type not in ('Hoshin-Tora', 'Hoshin-Kai', 'Hoshin-Renga', 'Renga') then raise exception 'Invalid result type'; end if;
    if v_tier not in ('Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5') then raise exception 'Invalid tier'; end if;

    select match_order into v_order
    from public.kitakana_elo_matches
    where owner_user_id = v_owner and match_code = v_code;
    if v_order is null then
      select coalesce(max(match_order), 0) + 1 into v_order
      from public.kitakana_elo_matches
      where owner_user_id = v_owner;
    end if;
    v_updated_at := now();

    insert into public.kitakana_elo_matches (
      owner_user_id, match_code, match_order, source_match_id, is_imported,
      team_a, team_b, website_team_a, website_team_b,
      winner, result_type, tier, score_a, score_b, score_text,
      event, notes, validation, submitted_by, updated_at
    ) values (
      v_owner,
      v_code,
      v_order,
      item->>'sourceMatchId',
      false,
      v_team_a,
      v_team_b,
      item->>'teamA',
      item->>'teamB',
      v_winner,
      v_result_type,
      v_tier,
      nullif(item->>'scoreA', '')::double precision,
      nullif(item->>'scoreB', '')::double precision,
      coalesce(item->>'score', ''),
      coalesce(item->>'tournamentName', ''),
      concat_ws(' | ',
        nullif(concat('website teams ', item->>'teamA', ' vs ', item->>'teamB'), ''),
        nullif(concat('score ', item->>'score'), 'score '),
        concat('source Tourney · ', v_code)
      ),
      'Pending',
      v_owner,
      v_updated_at
    )
    on conflict (owner_user_id, match_code) do update set
      source_match_id = excluded.source_match_id,
      team_a = excluded.team_a,
      team_b = excluded.team_b,
      website_team_a = excluded.website_team_a,
      website_team_b = excluded.website_team_b,
      winner = excluded.winner,
      result_type = excluded.result_type,
      tier = excluded.tier,
      score_a = excluded.score_a,
      score_b = excluded.score_b,
      score_text = excluded.score_text,
      event = excluded.event,
      notes = excluded.notes,
      validation = 'Pending',
      submitted_by = excluded.submitted_by,
      updated_at = excluded.updated_at;

    v_count := v_count + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'matchCode', v_code,
      'matchOrder', v_order,
      'updatedAt', v_updated_at
    ));
  end loop;

  perform public.kitakana_recalculate_internal(v_owner);
  return jsonb_build_object('ok', true, 'submitted', v_count, 'results', v_results, 'errors', '[]'::jsonb);
end;
$$;

revoke all on function public.kitakana_resolve_team_internal(uuid, text, text) from public, anon, authenticated;
revoke all on function public.kitakana_recalculate_internal(uuid) from public, anon, authenticated;
revoke all on function public.kitakana_side_context_internal(uuid, text) from public, anon, authenticated;

revoke all on function public.kitakana_elo_status() from public, anon;
revoke all on function public.kitakana_import_seed(jsonb) from public, anon;
revoke all on function public.kitakana_elo_context(text, text, text, text) from public, anon;
revoke all on function public.kitakana_submit_matches(jsonb) from public, anon;
grant execute on function public.kitakana_elo_status() to authenticated;
grant execute on function public.kitakana_import_seed(jsonb) to authenticated;
grant execute on function public.kitakana_elo_context(text, text, text, text) to authenticated;
grant execute on function public.kitakana_submit_matches(jsonb) to authenticated;
