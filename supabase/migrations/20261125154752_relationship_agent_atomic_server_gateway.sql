-- Backend-only JSON-v1 gateway with optimistic concurrency.
-- Public schema contains only two RPC functions, executable by service_role ONLY.
-- All relationship data remains in the non-exposed ra_private schema.

alter table ra_private.datasets
  add column revision bigint not null default 0 check (revision >= 0);

grant usage on schema ra_private to service_role;
grant select, insert, update, delete on ra_private.datasets,
  ra_private.relationships, ra_private.captures,
  ra_private.moments, ra_private.connection_journeys to service_role;
grant execute on function ra_private.import_store(uuid,jsonb) to service_role;
grant execute on function ra_private.export_store(uuid) to service_role;

create function public.ra_store_read(p_owner_id uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'revision', d.revision,
    'document', ra_private.export_store(d.owner_id)
  )
  from ra_private.datasets d where d.owner_id = p_owner_id;
$$;
revoke all on function public.ra_store_read(uuid) from public, anon, authenticated;
grant execute on function public.ra_store_read(uuid) to service_role;

create function public.ra_store_write(
  p_owner_id uuid, p_expected_revision bigint, p_document jsonb
)
returns bigint
language plpgsql security invoker
set search_path = ''
as $$
declare
  previous_revision bigint;
begin
  if p_owner_id is null
     or p_expected_revision is null
     or pg_catalog.jsonb_typeof(p_document) is distinct from 'object'
     or p_document->>'version' is distinct from '1'
     or pg_catalog.jsonb_typeof(p_document->'relationships') is distinct from 'array'
     or (p_document ? 'captures' and pg_catalog.jsonb_typeof(p_document->'captures') is distinct from 'array')
     or (p_document ? 'moments' and pg_catalog.jsonb_typeof(p_document->'moments') is distinct from 'array')
     or (p_document ? 'connectionJourneys' and pg_catalog.jsonb_typeof(p_document->'connectionJourneys') is distinct from 'array')
  then
    raise exception 'Invalid relationship store format' using errcode = '22023';
  end if;

  if p_expected_revision = -1 then
    perform ra_private.import_store(p_owner_id,p_document);
    return 0;
  end if;

  select d.revision into previous_revision
  from ra_private.datasets d
  where d.owner_id = p_owner_id
  for update;

  if not found or previous_revision <> p_expected_revision then
    raise exception 'Relationship store changed; retry with a fresh revision'
      using errcode = '40001';
  end if;

  -- All writes are one transaction. If any cast, check, or foreign key fails,
  -- this entire operation rolls back, including revision and deletes.
  delete from ra_private.connection_journeys where owner_id = p_owner_id;
  delete from ra_private.relationships where owner_id = p_owner_id;
  delete from ra_private.captures where owner_id = p_owner_id;
  delete from ra_private.moments where owner_id = p_owner_id;

  insert into ra_private.relationships(owner_id,id,ordinal,payload)
  select p_owner_id, (element->>'id')::uuid, (position-1)::integer, element
  from pg_catalog.jsonb_array_elements(p_document->'relationships')
    with ordinality as items(element,position);

  insert into ra_private.captures(owner_id,id,ordinal,payload)
  select p_owner_id, (element->>'id')::uuid, (position-1)::integer, element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'captures','[]'::jsonb))
    with ordinality as items(element,position);

  insert into ra_private.moments(owner_id,id,ordinal,payload)
  select p_owner_id, (element->>'id')::uuid, (position-1)::integer, element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'moments','[]'::jsonb))
    with ordinality as items(element,position);

  insert into ra_private.connection_journeys(owner_id,id,relationship_id,ordinal,payload)
  select p_owner_id, (element->>'id')::uuid, (element->>'relationshipId')::uuid, (position-1)::integer, element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'connectionJourneys','[]'::jsonb))
    with ordinality as items(element,position);

  update ra_private.datasets d
  set top_level_extras =
        p_document - 'version' - 'relationships' - 'captures'
                   - 'moments' - 'connectionJourneys',
      revision = previous_revision + 1
  where d.owner_id = p_owner_id;
  return previous_revision + 1;
end;
$$;
revoke all on function public.ra_store_write(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.ra_store_write(uuid,bigint,jsonb) to service_role;

