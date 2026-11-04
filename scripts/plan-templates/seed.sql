-- Seed plan_templates from the owner's own plans. Run once with the service
-- role (Supabase MCP execute_sql / SQL editor) AFTER 0050. Data, not schema:
-- the ids are production rows, so this is not a migration and a fresh clone
-- simply starts with an empty catalogue.
--
-- Copies `parsed` only. source_markdown, ids, dates-of-record and logs stay
-- on the owner's private rows.
insert into public.plan_templates (name, summary, parsed, sort_order)
select p.name, s.summary, p.parsed, s.sort_order
from public.plans p
join (values
  ('ebfb87e1-21d8-409f-a00d-1b2eb0fd90d0'::uuid, 1, null::text),
  ('c59aca45-8b9c-4890-882d-d46691b08aa1'::uuid, 2, null::text),
  ('9ebdbf53-6c5d-4b30-b1fa-1249bdbde5aa'::uuid, 3, null::text)
) as s(id, sort_order, summary) on s.id = p.id;
