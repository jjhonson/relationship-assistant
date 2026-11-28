import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({
  listRelationships:vi.fn(),getRelationship:vi.fn(),getCapture:vi.fn(),listCapturesForRelationship:vi.fn(),savePersonalMoment:vi.fn(),
  saveReviewedPersonCapture:vi.fn(),learnFromNewPastedConversation:vi.fn(),
  saveQuickCaptureWithoutRedirect:vi.fn(),saveUniversalCaptureWithoutRedirect:vi.fn(),
  revalidatePath:vi.fn(),
}));
vi.mock("@/lib/relationship-store",()=>({
  listRelationships:mocks.listRelationships,getRelationship:mocks.getRelationship,getCapture:mocks.getCapture,listCapturesForRelationship:mocks.listCapturesForRelationship,
  savePersonalMoment:mocks.savePersonalMoment,
}));
vi.mock("@/app/relationships/conversational-actions",()=>({saveReviewedPersonCapture:mocks.saveReviewedPersonCapture}));
vi.mock("@/app/relationships/actions",()=>({learnFromNewPastedConversation:mocks.learnFromNewPastedConversation}));
vi.mock("@/app/relationships/capture-actions",()=>({
  saveQuickCaptureWithoutRedirect:mocks.saveQuickCaptureWithoutRedirect,
  saveUniversalCaptureWithoutRedirect:mocks.saveUniversalCaptureWithoutRedirect,
}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidatePath}));

import { submitHomeText, saveHomePhotoInput } from "./actions";
import { createManualRelationshipRecord } from "@/lib/relationship-record";
import { personAnswerEvidence } from "@/lib/relationship-entry";

const submissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixtures(){
  const p=createManualRelationshipRecord("Rowan Taylor");
  p.id="rowan";
  const date="2024-04-12";
  p.lastInteractionAt=date;
  p.sources.push({id:"pasted:pet",label:"Fictional conversation",source:"manual",observedAt:date});
  p.durableFacts.push({id:"pet",label:"Dog's name",category:"Personal",value:"Cooper",sourceIds:["pasted:pet"],firstObservedAt:date,lastObservedAt:date});
  const other=createManualRelationshipRecord("Avery Morgan");
  other.id="avery";
  return {p,other};
}
function noWrites(){
  for(const spy of [mocks.savePersonalMoment,mocks.saveReviewedPersonCapture,mocks.learnFromNewPastedConversation,mocks.saveQuickCaptureWithoutRedirect,mocks.saveUniversalCaptureWithoutRedirect,mocks.revalidatePath])expect(spy).not.toHaveBeenCalled();
}
const capture={kind:"note",source:"unspecified",interactionDate:"",dateEvidence:"unknown",summary:"New memory",question:""};
function response(intent:string,evidenceIds:string[]=[],answerText="",answerNote=""){
  return new Response(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify({intent,evidenceIds,answerText,answerNote,capture})}]}]}),{status:200});
}
describe("read-only person entry routing",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV","development");
    vi.stubEnv("RA_DATASET_MODE","fictional");
    vi.stubEnv("RA_STORAGE_BACKEND","json");
    vi.stubEnv("OPENAI_API_KEY","");
    const {p,other}=fixtures();
    mocks.listRelationships.mockResolvedValue([p,other]);
    mocks.listCapturesForRelationship.mockResolvedValue([]);
    mocks.getRelationship.mockResolvedValue(p);
    mocks.saveReviewedPersonCapture.mockResolvedValue({saved:true,destination:"/relationships/rowan"});
  });
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it("answers an indirect question from local saved evidence with zero write calls",async()=>{
    const r=await submitHomeText({text:"Remind me of his dog's name",submissionId,contextRelationshipId:"rowan"});
    expect(r).toMatchObject({state:"answer",evidence:[{value:"Cooper"}],offline:true});
    noWrites();
  });
  it("does not convert missing information, a correction, or a different person into a saved note",async()=>{
    for(const text of ["What's his wife's name?","Actually his dog's name is Charlie.","What do we know about Avery Morgan?"]){
      const r=await submitHomeText({text,submissionId,contextRelationshipId:"rowan"});
      expect(r).toMatchObject({state:"answer",evidence:[]});
    }
    noWrites();
  });
  it("cannot force a question into a note via capture choices or a misclassified model response",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    const fetchMock=vi.fn(async()=>response("addition"));
    vi.stubGlobal("fetch",fetchMock);
    const r=await submitHomeText({text:"What is his dog's name",submissionId,contextRelationshipId:"rowan",choices:{kind:"note",relationshipId:"rowan"}});
    expect(r).toMatchObject({state:"answer",retainInput:true,evidence:[]});
    expect(fetchMock).toHaveBeenCalledOnce();
    noWrites();
  });
  it("uses model-selected evidence without exposing other records or updating contact recency",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    const {p}=fixtures();
    const id=personAnswerEvidence(p,"2026-11-27","dog")[0].id;
    const fetchMock=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const payload=JSON.parse(String(init?.body));
      expect(payload.input).not.toContain("Avery Morgan");
      expect(payload.store).toBe(false);
      return response("question",[id],"The recorded name of his dog is Cooper.");
    });
    vi.stubGlobal("fetch",fetchMock);
    const r=await submitHomeText({text:"What was his dog's name?",submissionId,contextRelationshipId:"rowan"});
    expect(r).toMatchObject({state:"answer",message:"The recorded name of his dog is Cooper.",evidence:[{value:"Cooper"}],offline:false});
    noWrites();
  });
  it("passes a clearly classified new memory through the established capture path",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    vi.stubGlobal("fetch",vi.fn(async()=>response("addition")));
    const r=await submitHomeText({text:"He enjoys pottery.",submissionId,contextRelationshipId:"rowan"});
    expect(r).toMatchObject({state:"saved",destination:"/relationships/rowan"});
    expect(mocks.saveReviewedPersonCapture).toHaveBeenCalledOnce();
    expect(mocks.saveReviewedPersonCapture).toHaveBeenCalledWith("rowan",expect.objectContaining({text:"He enjoys pottery.",kind:"note",interactionDate:"",returnToRelationship:true}));
  });
  it("rejects a question with a photo before invoking the image write path",async()=>{
    const form=new FormData();
    form.set("note","What is his dog's name?");
    form.set("photo",new File(["fixture"],"photo.jpg",{type:"image/jpeg"}));
    await expect(saveHomePhotoInput(form,"rowan")).rejects.toThrow("Questions or corrections");
    noWrites();
  });
  it("returns a successfully linked screenshot to its relationship, with the memory accessible",async()=>{
    const form=new FormData();
    form.set("note","Professional profile screenshot");
    form.set("photo",new File(["fixture"],"profile.png",{type:"image/png"}));
    mocks.saveUniversalCaptureWithoutRedirect.mockResolvedValue({error:null,captureId:"capture-1"});
    mocks.getCapture.mockResolvedValue({id:"capture-1",status:"interpreted",contextRelationshipId:"rowan",people:[{resolution:"linked",relationshipId:"rowan"}]});
    const r=await saveHomePhotoInput(form,"rowan");
    expect(r).toEqual({destination:"/relationships/rowan?memorySaved=capture-1"});
    expect(mocks.getCapture).toHaveBeenCalledWith("capture-1");
    expect(mocks.saveUniversalCaptureWithoutRedirect).toHaveBeenCalledOnce();
  });
  it("keeps an unresolved screenshot or a Home capture in saved-memory review",async()=>{
    const form=new FormData();
    form.set("note","Professional profile screenshot");
    form.set("photo",new File(["fixture"],"profile.png",{type:"image/png"}));
    mocks.saveUniversalCaptureWithoutRedirect.mockResolvedValue({error:null,captureId:"capture-1"});
    mocks.getCapture.mockResolvedValue({id:"capture-1",status:"pending",contextRelationshipId:"rowan",people:[]});
    expect(await saveHomePhotoInput(form,"rowan")).toEqual({destination:"/captures/capture-1"});
    mocks.getCapture.mockClear();
    expect(await saveHomePhotoInput(form)).toEqual({destination:"/captures/capture-1"});
    expect(mocks.getCapture).not.toHaveBeenCalled();
  });

  it("routes a dated received email to structured conversation capture even when quoted text describes changes or asks questions",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    vi.stubEnv("RELATIONSHIP_USER_TIME_ZONE","America/Denver");
    vi.useFakeTimers({toFake:["Date"]});
    vi.setSystemTime(new Date("2026-11-28T00:53:00.000Z"));
    try{
      const message="Email from Rowan on Nov 20 following our meeting:\nHi,\nWe're no longer pursuing the old project. I think we can revisit later. Could we talk then? Avery Morgan is involved.";
      const fetchMock=vi.fn(async()=>response("change"));
      vi.stubGlobal("fetch",fetchMock);
      const result=await submitHomeText({text:message,submissionId,contextRelationshipId:"rowan"});
      expect(result).toMatchObject({state:"saved",destination:"/relationships/rowan"});
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.saveReviewedPersonCapture).toHaveBeenCalledOnce();
      expect(mocks.saveReviewedPersonCapture).toHaveBeenCalledWith("rowan",expect.objectContaining({text:message,kind:"conversation",source:"email",interactionDate:"2026-11-20",submissionId}));
      expect(mocks.saveQuickCaptureWithoutRedirect).not.toHaveBeenCalled();
    }finally{vi.useRealTimers();}
  });
  it("asks for the sent date, not a quoted relative date, if the date is unknown",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    const result=await submitHomeText({text:"Email from Rowan:\nI spoke with Avery yesterday. We should catch up.",submissionId,contextRelationshipId:"rowan"});
    expect(result).toMatchObject({state:"clarify",field:"date",kind:"conversation"});
    noWrites();
  });
  it("does not attach a different or unknown sender to the selected person",async()=>{
    vi.stubEnv("OPENAI_API_KEY","fixture");
    for(const sender of ["Avery Morgan","Rowan Differentperson","Unlisted Person"]){
      const result=await submitHomeText({text:"Email from "+sender+" on Nov 20:\nA new update.",submissionId,contextRelationshipId:"rowan"});
      expect(result).toMatchObject({state:"answer",retainInput:true});
    }
    noWrites();
  });

});
