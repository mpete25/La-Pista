-- Seed: first tenant = Padel Lounge, Aalborg (the pitch-demo center).
insert into public.centers (slug, name, city)
values ('padel-lounge-aalborg', 'Padel Lounge', 'Aalborg')
on conflict (slug) do nothing;
