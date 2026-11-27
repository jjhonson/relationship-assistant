import { describe, expect, it } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { relationshipInteractionHistory, type RelationshipHistoryEntry } from "./relationship-overview";
import { relationshipConnectionStats } from "./relationship-connection-stats";
import type { ConnectionJourney } from "./connection-journey";

const today = "2026-11-27";
function person() {
  const p = createManualRelationshipRecord("Fixture Person", "Former colleague", undefined, new Date("2024-01-01T00:00:00Z"));
  p.lastInteractionAt = "2026-11-23";
  return p;
}
describe("recorded contact stats", () => {
  it("counts distinct valid contact days in twelve calendar months, never source counts, notes or duplicate same-day records", () => {
    const p = person();
    const entry = (id: string, date: string, countsAsContact: boolean): RelationshipHistoryEntry => ({ id, date, countsAsContact, label: "Fixture", detail: "" });
    const history = [
      entry("conversation", "2026-11-23", true), entry("duplicate", "2026-11-23", true),
      entry("note", "2026-11-24", false), entry("reply", "2026-02-02", true),
      entry("old", "2025-11-30", true), entry("first-month", "2025-12-01", true),
      entry("future", "2026-11-28", true), entry("invalid", "2026-02-30", true),
    ];
    const result = relationshipConnectionStats(p, history, today);
    expect(result.recordedDays).toBe(3);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toMatchObject({month:"2025-12",count:1});
    expect(result.months.at(-1)).toMatchObject({month:"2026-11",count:1});
    expect(result.group).toBe("Recently in touch");
  });
  it("excludes passive metadata, ordinary manual context, outbound drafts and sent-only events from recorded contact-day totals", () => {
    const p = person();
    p.sources.push(
      { id:"gmail:old",source:"gmail",observedAt:"2026-11-25",label:"Metadata" },
      { id:"manual:old",source:"manual",observedAt:"2026-11-22",label:"Recollection" },
      { id:"pasted:conversation",source:"manual",observedAt:"2026-11-23",label:"Conversation" },
    );
    const journey: ConnectionJourney = {id:"j",relationshipId:p.id,subject:"Fixture",basisId:"",basisSourceIds:[],startedAt:"2026-11-20",events:[
      {id:"sent",kind:"sent",happenedOn:"2026-11-21",recordedAt:"2026-11-21",summary:"Sent email",outcome:""},
      {id:"prepared",kind:"prepared",happenedOn:"2026-11-20",recordedAt:"2026-11-20",summary:"Draft",outcome:""},
      {id:"scheduled",kind:"meeting_scheduled",happenedOn:"2026-11-22",recordedAt:"2026-11-22",summary:"Scheduled",outcome:""},
      {id:"reply",kind:"reply_received",happenedOn:"2026-11-23",recordedAt:"2026-11-23",summary:"Reply",outcome:""},
      {id:"met",kind:"interaction_occurred",happenedOn:"2026-10-20",recordedAt:"2026-10-20",summary:"Met",outcome:""},
    ]};
    const history = relationshipInteractionHistory(p, [], [journey], today);
    expect(history.map((entry) => entry.id).sort()).toEqual(["event:met","event:reply","event:sent","pasted:conversation"]);
    expect(relationshipConnectionStats(p, history, today).recordedDays).toBe(2);
  });
  it("uses known recency and cadence instead of strength or frequency, and does not claim enough history from metadata alone", () => {
    const p = person();
    expect(relationshipConnectionStats(p, [], today).group).toBe("Insufficient history");
    const history = [{id:"one",date:"2026-01-01",label:"Conversation",detail:"",countsAsContact:true}];
    p.lastInteractionAt = "2026-01-01";
    expect(relationshipConnectionStats(p, history, today).group).toBe("Worth catching up");
    p.contactCadenceDays = 365;
    expect(relationshipConnectionStats(p, history, today).group).toBe("Within usual cadence");
    p.contactCadenceDays = 0;
    expect(relationshipConnectionStats(p, history, today).group).toBe("No regular cadence");
    p.lastInteractionAt = null;
    expect(relationshipConnectionStats(p, history, today).group).toBe("Insufficient history");
  });
});
