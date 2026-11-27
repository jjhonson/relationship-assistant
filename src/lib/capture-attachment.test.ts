import { describe, expect, it } from "vitest";
import { classifyCaptureAttachment, captureAttachmentAccept, clipboardPhoto } from "./capture-attachment";

describe("single memory attachment picker", () => {
  it("routes supported photos to the existing image path, with a size bound", () => {
    for (const type of ["image/jpeg","image/png","image/webp"]) {
      expect(classifyCaptureAttachment({name:"photo",type,size:4*1024*1024})).toEqual({kind:"photo"});
    }
    expect(classifyCaptureAttachment({name:"photo.png",type:"image/png",size:0}).kind).toBe("unsupported");
    expect(classifyCaptureAttachment({name:"photo.png",type:"image/png",size:4*1024*1024+1}).kind).toBe("unsupported");
    expect(classifyCaptureAttachment({name:"photo.png",type:"application/octet-stream",size:100}).kind).toBe("unsupported");
  });
  it("routes supported text extensions even when the OS does not supply a MIME type", () => {
    for (const name of ["notes.txt","transcript.MD","table.csv"]) {
      expect(classifyCaptureAttachment({name,type:"",size:100_000})).toEqual({kind:"text"});
    }
    expect(classifyCaptureAttachment({name:"notes.txt",type:"text/plain",size:0}).kind).toBe("unsupported");
    expect(classifyCaptureAttachment({name:"notes.txt",type:"text/plain",size:100_001}).kind).toBe("unsupported");
  });
  it("does not broaden the picker or supported formats", () => {
    expect(classifyCaptureAttachment({name:"notes.pdf",type:"application/pdf",size:20}).kind).toBe("unsupported");
    expect(classifyCaptureAttachment({name:"document.docx",type:"application/octet-stream",size:20}).kind).toBe("unsupported");
    expect(captureAttachmentAccept).not.toContain("pdf");
    expect(captureAttachmentAccept).not.toContain("docx");
  });
});

describe("explicit clipboard image paste", () => {
  const png=new File(["fictional"],"screenshot.png",{type:"image/png"});
  function item(file:File|null,type="image/png") {
    return {kind:"file",type,getAsFile:()=>file};
  }
  it("accepts a screenshot from clipboard items without duplicating its files representation",()=>{
    expect(clipboardPhoto({items:[item(png)],files:[png]})).toEqual({kind:"photo",file:png});
  });
  it("supports the files-only representation and a null item fallback",()=>{
    expect(clipboardPhoto({files:[png]})).toEqual({kind:"photo",file:png});
    expect(clipboardPhoto({items:[item(null)],files:[png]})).toEqual({kind:"photo",file:png});
  });
  it("leaves text, HTML, links and unrelated files to normal browser paste",()=>{
    expect(clipboardPhoto({items:[{kind:"string",type:"text/plain",getAsFile:()=>null}]})).toEqual({kind:"none"});
    expect(clipboardPhoto({items:[{kind:"string",type:"text/html",getAsFile:()=>null}]})).toEqual({kind:"none"});
    expect(clipboardPhoto({files:[new File(["text"],"note.txt",{type:"text/plain"})]})).toEqual({kind:"none"});
  });
  it("rejects multiple images and unsupported or oversized image data",()=>{
    expect(clipboardPhoto({files:[png,png]})).toMatchObject({kind:"unsupported"});
    expect(clipboardPhoto({files:[new File(["gif"],"clipboard.gif",{type:"image/gif"})]})).toMatchObject({kind:"unsupported"});
    expect(clipboardPhoto({files:[new File([],"empty.png",{type:"image/png"})]})).toMatchObject({kind:"unsupported"});
    expect(clipboardPhoto({files:[new File([new Uint8Array(4*1024*1024+1)],"large.png",{type:"image/png"})]})).toMatchObject({kind:"unsupported"});
  });
});
