import { describe, expect, it, vi } from "vitest";
import { createManualRelationshipRecord } from "./relationship-record";
import { interpretRelationshipEntry, personAnswerEvidence, scopedInputGuard } from "./relationship-entry";

const today="2026-11-27";
const observed="2026-11-23";
function person(){
  const p=createManualRelationshipRecord("Fictional Rowan");
  p.lastInteractionAt=observed;
  p.sources.push(
    {id:"pasted:fixture",source:"manual",label:"Fictional catch-up",observedAt:observed,submissionDigest:"private-digest"},
    {id:"pasted:old",source:"manual",label:"Earlier context",observedAt:"2024-01-01"},
  );
  p.durableFacts.push(
    {id:"dog",label:"Dog's name",category:"Personal",value:"Cooper",sourceIds:["pasted:fixture"],firstObservedAt:observed,lastObservedAt:observed},
    {id:"fish",label:"Former interest",category:"Interest",value:"Used to fish; no longer fishes.",sourceIds:["pasted:fixture"],firstObservedAt:observed,lastObservedAt:observed},
    {id:"company",label:"Company",category:"Work",value:"Example Software",sourceIds:["pasted:old","pasted:fixture"],firstObservedAt:"2024-01-01",lastObservedAt:observed},
    {id:"unsupported",label:"Phone",category:"Personal",value:"555-0100",sourceIds:["unknown"],firstObservedAt:observed,lastObservedAt:observed},
  );
  return p;
}
const capture={kind:"note",source:"unspecified",interactionDate:"",dateEvidence:"unknown",summary:"A new memory",question:""};
function result(intent:string,evidenceIds:string[]=[],proposed:unknown=capture,answerText=""){
  return new Response(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify({intent,evidenceIds,answerText,capture:proposed})}]}]}),{status:200});
}
describe("relationship entry",()=>{
  it("answers from saved evidence offline, including indirect questions without punctuation, and never mutates",async()=>{
    const record=person(),before=JSON.stringify(record);
    const fetchImpl=vi.fn();
    for(const text of ["What is his dog's name?","Remind me of his dog's name","What is Rowan's dog's name"]){
      const r=await interpretRelationshipEntry({text,record,today,offlinePreview:true},{apiKey:"",fetchImpl});
      expect(r.state).toBe("answer");
      if(r.state==="answer"){
        expect(r.evidence.map(e=>e.value)).toEqual(["Cooper"]);
        expect(r.offline).toBe(true);
        expect(r.message).toContain("Cooper");
        expect(r.message).toContain("recorded dog");
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(record)).toBe(before);
  });
  it("returns unknown, not a negative claim, for missing information; explicit past-state wording remains intact",async()=>{
    const record=person();
    const missing=await interpretRelationshipEntry({text:"What is his wife's name?",record,today,offlinePreview:true},{apiKey:""});
    expect(missing).toMatchObject({state:"answer",evidence:[],message:expect.stringContaining("don't have enough")});
    const past=await interpretRelationshipEntry({text:"Does he still fish?",record,today,offlinePreview:true},{apiKey:""});
    expect(past).toMatchObject({state:"answer",evidence:[{value:"Used to fish; no longer fishes."}]});
  });
  it("distinguishes explicit additions from interrogatives, uncertainty and corrections",()=>{
    expect(scopedInputGuard("His dog is Cooper.")).toBe("none");
    expect(scopedInputGuard("What is his dog's name")).toBe("question");
    expect(scopedInputGuard("Tell me what we know about his dog")).toBe("question");
    expect(scopedInputGuard("He likes jazz. What was the dog's name?")).toBe("question");
    expect(scopedInputGuard("Actually his dog's name is Charlie, not Cooper.")).toBe("change");
    expect(scopedInputGuard("He no longer fishes.")).toBe("change");
    expect(scopedInputGuard("Maybe his dog is named Charlie.")).toBe("uncertain");
    expect(scopedInputGuard("Here's the transcript:\nRowan: How are you?\nMe: Great.")).toBe("none");
  });
  it("rejects a model trying to classify an obvious question as an addition",async()=>{
    const record=person();
    const fetchImpl=vi.fn(async()=>result("addition"));
    const r=await interpretRelationshipEntry({text:"What is his dog's name",record,today,offlinePreview:false},{apiKey:"test",fetchImpl});
    expect(r).toMatchObject({state:"answer",retainInput:true,evidence:[]});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("returns only exact selected evidence and sends a bounded projection without raw digests",async()=>{
    const record=person();
    const dog=personAnswerEvidence(record,today,"dog").find(e=>e.label==="Dog's name")!;
    const fetchImpl=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.text.format.schema.properties.intent.enum).toContain("question");
      expect(body.input).not.toContain("private-digest");
      expect(body.input).not.toContain("555-0100");
      return result("question",[dog.id],capture,"His dog is named Cooper, as mentioned on November 23, 2026.");
    });
    const r=await interpretRelationshipEntry({text:"His pet's name, please",record,today,offlinePreview:false},{apiKey:"test",fetchImpl});
    expect(r).toMatchObject({state:"answer",message:"His dog is named Cooper, as mentioned on November 23, 2026.",evidence:[{value:"Cooper",sources:[{label:"Fictional catch-up",observedAt:observed}]}]});
    const invented=await interpretRelationshipEntry({text:"What is his dog's name?",record,today,offlinePreview:false},
      {apiKey:"test",fetchImpl:vi.fn(async()=>result("question",["not-a-real-id"],capture,"His dog is Max."))});
    expect(invented).toMatchObject({state:"answer",evidence:[],message:expect.stringContaining("don't have enough")});
  });
  it("only clearly classified additions reach validated capture; the offline preview never enables writes",async()=>{
    const record=person();
    const fetchImpl=vi.fn(async()=>result("addition"));
    const r=await interpretRelationshipEntry({text:"He enjoys pottery.",record,today,offlinePreview:false},{apiKey:"test",fetchImpl});
    expect(r).toMatchObject({state:"interpretation",interpretation:capture});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const offline=await interpretRelationshipEntry({text:"He enjoys pottery.",record,today,offlinePreview:true},{apiKey:""});
    expect(offline).toMatchObject({state:"answer",retainInput:true,evidence:[]});
    const change=await interpretRelationshipEntry({text:"Delete his old email address.",record,today,offlinePreview:false},{apiKey:"test",fetchImpl});
    expect(change).toMatchObject({state:"answer",retainInput:true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("shows only exact-value evidence, not older linked context or unsourced fields",()=>{
    const e=personAnswerEvidence(person(),today,"company");
    expect(e.find(x=>x.label==="Company")?.sources.map(s=>s.observedAt)).toEqual([observed]);
    expect(e.some(x=>x.value==="555-0100")).toBe(false);
  });
  it("shows a direct literal answer when the model gives no usable prose",async()=>{
    const record=person(),dog=personAnswerEvidence(record,today,"dog").find(e=>e.label==="Dog's name")!;
    for(const answerText of ["","<script>unknown</script>","x".repeat(1001)]){
      const r=await interpretRelationshipEntry({text:"What is his dog's name?",record,today,offlinePreview:false},
        {apiKey:"test",fetchImpl:vi.fn(async()=>result("question",[dog.id],capture,answerText))});
      expect(r).toMatchObject({state:"answer",message:expect.stringContaining("Cooper")});
    }
  });
  it("does not present uncited guesses or hide competing contact values",async()=>{
    const record=person();
    record.durableFacts.push({id:"old-company",label:"Company",category:"Work",value:"Previous Company",sourceIds:["pasted:old"],firstObservedAt:"2024-01-01",lastObservedAt:"2024-01-01"});
    const item=personAnswerEvidence(record,today,"company").find(e=>e.value==="Example Software")!;
    const r=await interpretRelationshipEntry({text:"Where does he work?",record,today,offlinePreview:false},
      {apiKey:"test",fetchImpl:vi.fn(async()=>result("question",[item.id],capture,"He definitely works at Example Software."))});
    expect(r).toMatchObject({state:"answer",message:expect.stringContaining("multiple recorded values"),evidence:[{value:"Example Software"},{value:"Previous Company"}]});
    const unsupported=await interpretRelationshipEntry({text:"What's his wife's name?",record,today,offlinePreview:false},
      {apiKey:"test",fetchImpl:vi.fn(async()=>result("question",[],capture,"Her name is invented."))});
    expect(unsupported).toMatchObject({state:"answer",message:expect.stringContaining("don't have enough"),evidence:[]});
  });

});
