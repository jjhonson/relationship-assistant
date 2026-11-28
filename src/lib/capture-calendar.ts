import type { CaptureEvent } from "./capture";
import type { RelationshipRecord } from "./relationship-record";

/** A capture is timestamped in UTC, but its calendar day belongs to the user.
 * Explicit reported encounter dates are already calendar dates, not timestamps. */
export function captureLocalDay(capturedAt:string, timeZone=process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver"):string {
  const instant=new Date(capturedAt);
  if(!Number.isFinite(instant.valueOf()))return "";
  return new Intl.DateTimeFormat("sv-SE",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
  }).format(instant);
}

/** Legacy captures used capturedAt.slice(0,10) (UTC). Correct their display
 * dates only when the exact persisted capture, person link and original source
 * date establish the mismatch. Never shift a reported conversation or an
 * unrelated source; never persist this derived projection. */
export function localCaptureEvidence(record:RelationshipRecord,captures:readonly CaptureEvent[],
  timeZone=process.env.RELATIONSHIP_USER_TIME_ZONE ?? "America/Denver"):RelationshipRecord {
  const originals=new Map(record.sources.map(source=>[source.id,source]));
  const corrections=new Map<string,string>();
  for(const capture of captures){
    if(capture.reportedInteractionAt || capture.status!=="interpreted" ||
      !capture.people.some(person=>person.relationshipId===record.id&&person.resolution!=="needs-review"))continue;
    const id="capture:"+capture.id;
    const source=originals.get(id);
    const utc=capture.capturedAt.slice(0,10);
    const local=captureLocalDay(capture.capturedAt,timeZone);
    if(source?.source==="capture" && source.observedAt===utc && local && local!==utc)corrections.set(id,local);
  }
  if(!corrections.size)return record;
  function adjust(date:string,ids:string[],which:"first"|"last"){
    // Only change an endpoint when a linked observation on that exact
    // original day was corrected. Unrelated dates remain untouched.
    const matches=ids.flatMap(id=>{
      const source=originals.get(id);
      return source?.observedAt===date?[{id,day:corrections.get(id)??date}]:[];
    });
    if(!matches.some(item=>corrections.has(item.id)))return date;
    const ordered=matches.map(item=>item.day).sort();
    return (which==="first"?ordered[0]:ordered.at(-1))??date;
  }
  return {
    ...record,
    sources:record.sources.map(source=>corrections.has(source.id)?{...source,observedAt:corrections.get(source.id)!}:source),
    durableFacts:record.durableFacts.map(fact=>{
      const first=adjust(fact.firstObservedAt,fact.sourceIds,"first");
      const last=adjust(fact.lastObservedAt,fact.sourceIds,"last");
      return first!==fact.firstObservedAt||last!==fact.lastObservedAt
        ? {...fact,firstObservedAt:first,lastObservedAt:last}:fact;
    }),
  };
}
