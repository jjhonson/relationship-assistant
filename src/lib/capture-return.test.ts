import { describe, expect, it, vi } from "vitest";
import { newCaptureEvent, type CapturedPerson, type CaptureEvent } from "./capture";
import { captureAppliedToPerson, savedCaptureDestination } from "./capture-return";

const linked:CapturedPerson={name:"Fictional Robin",resolution:"linked",relationshipId:"robin",candidateIds:[],company:"Example Software",jobTitle:"Director",email:"",phone:"",city:"",linkedin:"",facts:[]};
function event():CaptureEvent {
  return {...newCaptureEvent("Fictional profile note","robin"),id:"memory-1",status:"interpreted",people:[linked]};
}
describe("person-first capture return",()=>{
  it("returns to the exact existing relationship only after a persisted, fully linked interpretation",async()=>{
    const capture=event();
    const read=vi.fn(async()=>capture);
    expect(captureAppliedToPerson(capture,"robin")).toBe(true);
    expect(await savedCaptureDestination("memory-1","robin",read)).toBe("/relationships/robin?memorySaved=memory-1");
    expect(read).toHaveBeenCalledWith("memory-1");
  });
  it("preserves review for pending, unknown, new, mixed or mismatched identities",async()=>{
    const original=event();
    const cases:CaptureEvent[]=[
      {...original,status:"pending",people:[]},
      {...original,people:[]},
      {...original,people:[{...linked,resolution:"needs-review",relationshipId:null}]},
      {...original,people:[{...linked,resolution:"created"}]},
      {...original,people:[linked,{...linked,name:"Fictional Avery",relationshipId:"avery"}]},
      {...original,people:[{...linked,relationshipId:"avery"}]},
      {...original,contextRelationshipId:"avery"},
      {...original,id:"other-memory"},
    ];
    for(const capture of cases)expect(await savedCaptureDestination("memory-1","robin",async()=>capture)).toBe("/captures/memory-1");
  });
  it("preserves the saved memory route for Home and inconclusive post-save reads",async()=>{
    const read=vi.fn(async()=>event());
    expect(await savedCaptureDestination("memory-1",null,read)).toBe("/captures/memory-1");
    expect(read).not.toHaveBeenCalled();
    expect(await savedCaptureDestination("memory-1","robin",async()=>null)).toBe("/captures/memory-1");
    expect(await savedCaptureDestination("memory-1","robin",async()=>{throw Error("read failed");})).toBe("/captures/memory-1");
  });
});
