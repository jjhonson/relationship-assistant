-- Synthetic-only, transactional test for the server gateway.
-- Never store actual contact information here.
begin;
do $security$
begin
  if pg_catalog.has_function_privilege('anon','public.ra_store_read(uuid)','execute') or
     pg_catalog.has_function_privilege('authenticated','public.ra_store_read(uuid)','execute') or
     pg_catalog.has_function_privilege('anon','public.ra_store_write(uuid,bigint,jsonb)','execute') or
     pg_catalog.has_function_privilege('authenticated','public.ra_store_write(uuid,bigint,jsonb)','execute') then
    raise exception 'Private relationship RPC is exposed to browser roles';
  end if;
end
$security$;

set local role service_role;

do $test$
declare
  owner uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  initial jsonb := '{"version":1,"relationships":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","personLabel":"Fictional Judy","sources":[]}],"captures":[],"moments":[],"connectionJourneys":[]}'::jsonb;
  changed jsonb;
  result jsonb;
  rejected boolean;
begin
  if public.ra_store_write(owner,-1,initial) != 0 then
    raise exception 'Initial revision was not 0';
  end if;
  result := public.ra_store_read(owner);
  if (result->>'revision')::bigint != 0 or result->'document' != initial then
    raise exception 'Initial snapshot was not preserved';
  end if;
  changed := pg_catalog.jsonb_set(initial,'{relationships,0,personLabel}','"Fictional Judy Corrected"'::jsonb);
  if public.ra_store_write(owner,0,changed) != 1 then
    raise exception 'Revision did not advance to 1';
  end if;
  rejected := false;
  begin
    perform public.ra_store_write(owner,0,initial);
  exception when serialization_failure then rejected := true;
  end;
  if not rejected then raise exception 'Stale mutation accepted'; end if;
  if public.ra_store_read(owner)->'document' != changed then
    raise exception 'Stale mutation overwrote newer data';
  end if;
  rejected := false;
  begin
    perform public.ra_store_write(owner,1,'{"version":1,"relationships":[{"id":"invalid","personLabel":"broken"}]}'::jsonb);
  exception when invalid_text_representation then rejected := true;
  end;
  if not rejected then raise exception 'Corrupt record unexpectedly accepted'; end if;
  result := public.ra_store_read(owner);
  if (result->>'revision')::bigint != 1 or result->'document' != changed then
    raise exception 'Failed write modified database';
  end if;
end
$test$;
select 'synthetic gateway, version conflict and rollback passed' as result;
rollback;
-- Verify no test owner remains. A rollback is not a backup / independent restore.
