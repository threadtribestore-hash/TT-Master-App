-- Per-person limits in Studio (run once in Supabase → SQL Editor, after team_access_setup.sql).
-- Owners set these in Settings → Team & access → Limits. They trim a person's screens and
-- money figures on top of their role. Data rules still come from the role (studio_can_read /
-- studio_can_write); limits only narrow what the person sees.

alter table public.studio_team
  add column if not exists limits jsonb not null default '{}'::jsonb;

-- Lets a signed-in team member read their own limits (they can't read or change studio_team).
create or replace function public.team_limits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.limits from public.studio_team t
      where lower(t.email) = lower(auth.jwt() ->> 'email') and t.active
      limit 1),
    '{}'::jsonb);
$$;

revoke all on function public.team_limits() from public;
grant execute on function public.team_limits() to authenticated;
