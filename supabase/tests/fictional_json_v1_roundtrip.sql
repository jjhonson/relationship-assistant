-- Execute against the development Supabase DB only, using an authorized
-- SQL administrator. Entire test is rolled back; no test person remains.
-- This uses a deliberately fictional JSON-v1 dataset.
begin;
do $test$
declare
  expected jsonb := '{
    "version":1,
    "relationships":[{
      "id":"22222222-2222-4222-8222-222222222222",
      "personLabel":"Judy Example",
      "lastInteractionAt":"2026-11-23",
      "sources":[{"id":"capture:fictional-one","source":"capture","observedAt":"2026-11-20","label":"Fictional conversation"}],
      "durableFacts":[{
        "id":"fact:fictional-running","category":"Interest","label":"Running",
        "value":"Considering a December 5K","sourceIds":["capture:fictional-one"],
        "firstObservedAt":"2026-11-20","lastObservedAt":"2026-11-20"
      }],
      "actionableMemoryFeedback":[{
        "kind":"opportunity","key":"fictional-race","disposition":"Edit",
        "originalText":"She ran a 5K","originalContext":"December",
        "sourceIds":["capture:fictional-one"],"decidedAt":"2026-11-24T10:00:00Z",
        "replacement":{"text":"Considering a 5K","context":"December"}
      }]
    }],
    "captures":[{
      "id":"33333333-3333-4333-8333-333333333333",
      "capturedAt":"2026-11-20T10:00:00Z","sourceIds":["capture:fictional-one"],
      "summary":"Fictional November running conversation"
    }],
    "moments":[{
      "id":"44444444-4444-4444-8444-444444444444",
      "createdAt":"2026-11-23T11:00:00Z",
      "description":"Read a fictional running article","consideration":"private"
    }],
    "connectionJourneys":[{
      "id":"55555555-5555-4555-8555-555555555555",
      "relationshipId":"22222222-2222-4222-8222-222222222222",
      "events":[{
        "id":"66666666-6666-4666-8666-666666666666",
        "kind":"reply_received","happenedOn":"2026-11-23",
        "outcome":"Considering a weekend running group"
      }]
    }],
    "experimentalTopField":{"kept":true}
  }'::jsonb;
  actual jsonb;
begin
  perform ra_private.import_store('11111111-1111-4111-8111-111111111111'::uuid,expected);
  actual := ra_private.export_store('11111111-1111-4111-8111-111111111111'::uuid);
  if actual is distinct from expected then
    raise exception 'Source JSON changed during round-trip';
  end if;
  if (select count(*) from ra_private.relationships
      where owner_id='11111111-1111-4111-8111-111111111111') != 1 then
    raise exception 'Relationship count mismatch';
  end if;
  if (select count(*) from ra_private.connection_journeys
      where relationship_id='22222222-2222-4222-8222-222222222222') != 1 then
    raise exception 'Journey reference lost';
  end if;
  begin
    perform ra_private.import_store('11111111-1111-4111-8111-111111111111'::uuid,expected);
    raise exception 'Duplicate import unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
end
$test$;
select 'fictional round-trip passed' as result;
rollback;

-- After execution, separately verify counts are unchanged and
-- that no test owner namespace remains. Do not run against real data.
