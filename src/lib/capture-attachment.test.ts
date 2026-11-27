import { describe, expect, it } from "vitest";
import { classifyCaptureAttachment, captureAttachmentAccept } from "./capture-attachment";

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
