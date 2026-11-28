import { describe, expect, it, vi } from "vitest";
import { captureLocalDay, localCaptureEvidence } from "./capture-calendar";
import { applyCaptureExtraction, newCaptureEvent, newImageCaptureEvent, type CaptureExtraction } from "./capture";
import { createManualRelationshipRecord } from "./relationship-record";
import { relationshipContactFields, relationshipInteractionHistory } from "./relationship-overview";
import { personAnswerEvidence } from "./relationship-entry";

const instant=new Date("2026-11-28T00:11:00.000Z");
const today="2026-11-27";
const personName="Fictional Robin Taylor";
const email="robin@example.com";
const linkedin="https://www.linkedin.com/in/fictional-robin/";
const extraction:CaptureExtraction={
  summary:"Added contact details",participants:[{name:personName,email,linkedin,company:"",jobTitle:"",city:"",phone:"",facts:[]}],
  sharedDetails:[],otherPeople:[],commitments:[],
};
function fixture(){
  const record=createManualRelationshipRecord(personName,undefined,undefined,new Date("2026-11-20T18:00:00Z"));
  record.lastInteractionAt="2026-11-20";
  return record;
}
describe("capture calendar and immediate contact visibility",()=>{
  it("uses local calendar days at winter and summer UTC boundaries",()=>{
    expect(captureLocalDay(instant.toISOString(),"America/Denver")).toBe(today);
    expect(captureLocalDay("2026-07-01T00:30:00.000Z","America/Denver")).toBe("2026-06-30");
    expect(captureLocalDay(instant.toISOString(),"UTC")).toBe("2026-11-28");
    expect(captureLocalDay("invalid","America/Denver")).toBe("");
  });
  it("makes a newly captured email and LinkedIn visible on the same local day without claiming an encounter",()=>{
    vi.stubEnv("RELATIONSHIP_USER_TIME_ZONE","America/Denver");
    try{
      const p=fixture();
      for(const event of [newCaptureEvent(linkedin+" - LinkedIn\n"+email+" - email",p.id,instant),
        newImageCaptureEvent({note:"Profile screenshot",sourceText:email+"\n"+linkedin,visualDetails:""},p.id,instant)]){
        const applied=applyCaptureExtraction(event,extraction,[p],instant);
        const record=applied.relationships[0];
        const fields=relationshipContactFields(record,today);
        expect(fields.find(field=>field.label==="Email")?.primary).toMatchObject({value:email,observedAt:today});
        expect(fields.find(field=>field.label==="LinkedIn")?.primary).toMatchObject({value:linkedin,observedAt:today});
        expect(record.lastInteractionAt).toBe(p.lastInteractionAt);
        expect(applied.event.capturedAt).toBe(instant.toISOString());
        expect(relationshipInteractionHistory(record,[applied.event],[],today)).toEqual([expect.objectContaining({date:today,countsAsContact:false})]);
      }
    }finally{vi.unstubAllEnvs();}
  });
  it("recovers the exact legacy capture date for display and Q&A, without modifying persisted data",()=>{
    vi.stubEnv("RELATIONSHIP_USER_TIME_ZONE","UTC");
    try{
      const p=fixture();
      const event=newCaptureEvent(linkedin+" - LinkedIn\n"+email+" - email",p.id,instant);
      const applied=applyCaptureExtraction(event,extraction,[p],instant);
      const original=applied.relationships[0];
      const before=JSON.stringify(original);
      expect(relationshipContactFields(original,today).find(f=>f.label==="Email")?.primary).toBeNull();
      const display=localCaptureEvidence(original,[applied.event],"America/Denver");
      expect(relationshipContactFields(display,today).find(f=>f.label==="Email")?.primary?.value).toBe(email);
      expect(relationshipContactFields(display,today).find(f=>f.label==="LinkedIn")?.primary?.value).toBe(linkedin);
      expect(personAnswerEvidence(display,today,"email")).toEqual(expect.arrayContaining([expect.objectContaining({label:"Email",value:email,observedAt:today})]));
      expect(JSON.stringify(original)).toBe(before);
      expect(display.lastInteractionAt).toBe(p.lastInteractionAt);
      expect(localCaptureEvidence(original,[{...applied.event,reportedInteractionAt:"2026-11-28"}],"America/Denver")).toBe(original);
      expect(localCaptureEvidence(original,[{...applied.event,people:[]}],"America/Denver")).toBe(original);
      expect(localCaptureEvidence(original,[],"America/Denver")).toBe(original);
    }finally{vi.unstubAllEnvs();}
  });
});
