import { describe, expect, it } from "vitest";
import { introducedEmail, introducedEmailDay, introducedEmailInterpretation, looksLikePastedConversation, protectTranscriptInterpretation } from "./conversational-capture";
const today="2026-11-27";
describe("explicit received email boundary",()=>{
  it("recognizes a separate email body and its stated sent date",()=>{
    const text="Email from Fictional Robin on Nov 20 following our meeting:\nHi,\nI'm not ready yet. I think we can revisit later. Could we talk?";
    expect(introducedEmail(text)).toEqual({sender:"Fictional Robin",dateText:"Nov 20 following our meeting"});
    expect(looksLikePastedConversation(text)).toBe(true);
    expect(introducedEmailInterpretation(text,today)).toMatchObject({kind:"conversation",source:"email",interactionDate:"2026-11-20",dateEvidence:"explicit"});
    expect(protectTranscriptInterpretation(text,{kind:"note",source:"unspecified",interactionDate:"",dateEvidence:"unknown",summary:"New note",question:""},today)).toMatchObject({kind:"conversation",source:"email",interactionDate:"2026-11-20"});
  });
  it("does not invent a sent date from body text or ambiguous, invalid or future dates",()=>{
    expect(introducedEmailInterpretation("Email from Robin:\nI met someone yesterday.",today)?.interactionDate).toBe("");
    for(const value of ["Nov 20 or 21","Nov 30","Feb 30, 2026","Jan 3","unknown"])expect(introducedEmailDay(value,today)).toBe("");
    expect(introducedEmailDay("Nov 20, 2025",today)).toBe("2025-11-20");
    expect(introducedEmailDay("2026-11-20",today)).toBe("2026-11-20");
  });
  it("does not identify a question, correction or empty header as a supplied email",()=>{
    for(const text of ["What did the email from Robin say?","Delete the email from Robin:\nHi","Email from Robin:","Email from Robin:\n  "])expect(introducedEmail(text)).toBeNull();
  });
});
