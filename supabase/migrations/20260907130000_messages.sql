-- Direct messages between players in the same center.
--
-- The Beskeder tab has been running on in-memory React state, so a message
-- vanished on reload and never reached the other player. This gives it a
-- real table, center-scoped RLS and realtime delivery.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers (id),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_not_to_self check (sender_id <> recipient_id)
);

-- Reading one conversation, newest last; and counting what is unread.
create index messages_thread_idx
  on public.messages (center_id, sender_id, recipient_id, created_at);
create index messages_unread_idx
  on public.messages (recipient_id, created_at desc)
  where read_at is null;

alter table public.messages enable row level security;

-- A message is visible to exactly two people, and never across centers.
create policy "participants read their messages"
  on public.messages for select
  using (
    center_id = public.current_center_id()
    and (sender_id = auth.uid() or recipient_id = auth.uid())
  );

-- You may only send as yourself, and only to someone in your own center.
create policy "players send their own messages"
  on public.messages for insert
  with check (
    center_id = public.current_center_id()
    and sender_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = recipient_id and p.center_id = public.current_center_id()
    )
  );

-- The recipient marks a thread as read. Column grants below make sure that
-- is the only thing an update can touch: message text is never rewritten.
create policy "recipient marks messages read"
  on public.messages for update
  using (recipient_id = auth.uid() and center_id = public.current_center_id())
  with check (recipient_id = auth.uid() and center_id = public.current_center_id());

revoke update on table public.messages from anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

-- Deliberately no delete policy: a sent message stays sent.

-- Realtime: the app subscribes so an open conversation updates live.
alter publication supabase_realtime add table public.messages;
