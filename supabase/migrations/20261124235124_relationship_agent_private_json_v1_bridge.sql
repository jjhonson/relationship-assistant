-- Relationship Agent personal-alpha: private, reversible JSON-v1 bridge.
-- Applied to Supabase project nvtgwwfzhzuwqpvaycnk as migration 20261124235124.
-- IMPORTANT: no customer / personal relationship data belongs in this repository.
-- No Data API access is granted to browser roles. App integration is a separate milestone.

create schema if not exists ra_private;
revoke all on schema ra_private from public, anon, authenticated, service_role;

create table ra_private.datasets (
  owner_id uuid primary key,
  source_version smallint not null default 1 check (source_version = 1),
  top_level_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(top_level_extras) = 'object'),
  created_at timestamptz not null default now()
);

create table ra_private.relationships (
  owner_id uuid not null references ra_private.datasets(owner_id) on delete restrict,
  id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  person_label text generated always as (payload->>'personLabel') stored,
  last_interaction_at text generated always as (payload->>'lastInteractionAt') stored,
  primary key (owner_id,id),
  unique (owner_id,ordinal),
  check (payload ? 'id' and payload->>'id'=id::text),
  check (nullif(btrim(payload->>'personLabel'),'') is not null)
);
create index relationship_agent_recency_idx on ra_private.relationships
  (owner_id,last_interaction_at nulls first,id);
create index relationship_agent_name_idx on ra_private.relationships(owner_id,person_label);

create table ra_private.captures (
  owner_id uuid not null references ra_private.datasets(owner_id) on delete restrict,
  id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (owner_id,id),
  unique (owner_id,ordinal),
  check (payload ? 'id' and payload->>'id'=id::text)
);
create table ra_private.moments (
  owner_id uuid not null references ra_private.datasets(owner_id) on delete restrict,
  id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (owner_id,id),
  unique (owner_id,ordinal),
  check (payload ? 'id' and payload->>'id'=id::text)
);
create table ra_private.connection_journeys (
  owner_id uuid not null references ra_private.datasets(owner_id) on delete restrict,
  id uuid not null,
  relationship_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (owner_id,id),
  unique (owner_id,ordinal),
  foreign key (owner_id,relationship_id)
    references ra_private.relationships(owner_id,id) on delete restrict,
  check (payload ? 'id' and payload->>'id'=id::text),
  check (payload ? 'relationshipId' and payload->>'relationshipId'=relationship_id::text)
);

-- RLS is enabled with no allow policies, and ra_private is not exposed
-- as an API schema. Only a trusted DB session with deliberate privileges
-- may access this first-stage bridge.
alter table ra_private.datasets enable row level security;
alter table ra_private.relationships enable row level security;
alter table ra_private.captures enable row level security;
alter table ra_private.moments enable row level security;
alter table ra_private.connection_journeys enable row level security;
revoke all on all tables in schema ra_private from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ra_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema ra_private
  revoke execute on functions from public, anon, authenticated, service_role;

-- Imports a complete existing JSON version 1 payload under a unique owner.
-- A duplicate owner, missing ID, invalid UUID, duplicate record or unknown
-- journey person rejects the whole transaction. No upserts or silent replacement.
create function ra_private.import_store(p_owner_id uuid, p_document jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_owner_id is null
     or jsonb_typeof(p_document) is distinct from 'object'
     or p_document->>'version' is distinct from '1'
     or jsonb_typeof(p_document->'relationships') is distinct from 'array'
     or (p_document ? 'captures' and jsonb_typeof(p_document->'captures') is distinct from 'array')
     or (p_document ? 'moments' and jsonb_typeof(p_document->'moments') is distinct from 'array')
     or (p_document ? 'connectionJourneys' and jsonb_typeof(p_document->'connectionJourneys') is distinct from 'array')
  then
    raise exception 'Invalid or unsupported JSON-v1 relationship store';
  end if;

  insert into ra_private.datasets(owner_id,source_version,top_level_extras)
  values (
    p_owner_id,1,
    p_document - 'version' - 'relationships' - 'captures' - 'moments' - 'connectionJourneys'
  );

  insert into ra_private.relationships(owner_id,id,ordinal,payload)
  select p_owner_id,(element->>'id')::uuid,(position-1)::integer,element
  from pg_catalog.jsonb_array_elements(p_document->'relationships')
    with ordinality as items(element,position);

  insert into ra_private.captures(owner_id,id,ordinal,payload)
  select p_owner_id,(element->>'id')::uuid,(position-1)::integer,element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'captures','[]'::jsonb))
    with ordinality as items(element,position);

  insert into ra_private.moments(owner_id,id,ordinal,payload)
  select p_owner_id,(element->>'id')::uuid,(position-1)::integer,element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'moments','[]'::jsonb))
    with ordinality as items(element,position);

  insert into ra_private.connection_journeys(owner_id,id,relationship_id,ordinal,payload)
  select p_owner_id,(element->>'id')::uuid,(element->>'relationshipId')::uuid,(position-1)::integer,element
  from pg_catalog.jsonb_array_elements(coalesce(p_document->'connectionJourneys','[]'::jsonb))
    with ordinality as items(element,position);
end;
$$;
revoke all on function ra_private.import_store(uuid,jsonb) from public, anon, authenticated, service_role;

create function ra_private.export_store(p_owner_id uuid)
returns jsonb
language sql stable
security invoker
set search_path = ''
as $$
  select d.top_level_extras || pg_catalog.jsonb_build_object(
    'version', d.source_version,
    'relationships', coalesce((
      select pg_catalog.jsonb_agg(r.payload order by r.ordinal)
      from ra_private.relationships r where r.owner_id = d.owner_id
    ),'[]'::jsonb),
    'captures', coalesce((
      select pg_catalog.jsonb_agg(c.payload order by c.ordinal)
      from ra_private.captures c where c.owner_id = d.owner_id
    ),'[]'::jsonb),
    'moments', coalesce((
      select pg_catalog.jsonb_agg(m.payload order by m.ordinal)
      from ra_private.moments m where m.owner_id = d.owner_id
    ),'[]'::jsonb),
    'connectionJourneys', coalesce((
      select pg_catalog.jsonb_agg(j.payload order by j.ordinal)
      from ra_private.connection_journeys j where j.owner_id = d.owner_id
    ),'[]'::jsonb)
  )
  from ra_private.datasets d
  where d.owner_id = p_owner_id;
$$;
revoke all on function ra_private.export_store(uuid) from public, anon, authenticated, service_role;
