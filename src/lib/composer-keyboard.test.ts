import { describe, expect, it } from "vitest";
import { shouldSubmitComposerKey } from "./composer-keyboard";
describe("composer keyboard behavior",()=>{
  const enter={key:"Enter",shiftKey:false,isComposing:false,keyCode:13};
  it("submits on Enter",()=>expect(shouldSubmitComposerKey(enter)).toBe(true));
  it("leaves Shift+Enter as a newline",()=>expect(shouldSubmitComposerKey({...enter,shiftKey:true})).toBe(false));
  it("does not intercept IME input or other keys",()=>{
    expect(shouldSubmitComposerKey({...enter,isComposing:true})).toBe(false);
    expect(shouldSubmitComposerKey({...enter,keyCode:229})).toBe(false);
    expect(shouldSubmitComposerKey({...enter,key:"a",keyCode:65})).toBe(false);
  });
});
