/** One picker, with the same bounded image and text ingestion paths.
 * A file extension alone must not authorize an image upload. */
export const captureAttachmentAccept = "image/jpeg,image/png,image/webp,.txt,.md,.csv,text/plain,text/markdown,text/csv";

export type CaptureAttachmentChoice =
  | { kind: "photo" }
  | { kind: "text" }
  | { kind: "unsupported"; message: string };

export function classifyCaptureAttachment(file: { name: string; type: string; size: number }): CaptureAttachmentChoice {
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return file.size > 0 && file.size <= 4 * 1024 * 1024
      ? { kind: "photo" }
      : { kind: "unsupported", message: "Choose a JPEG, PNG or WebP up to 4 MB." };
  }
  if (/\.(txt|md|csv)$/i.test(file.name)) {
    return file.size > 0 && file.size <= 100_000
      ? { kind: "text" }
      : { kind: "unsupported", message: "Choose a .txt, .md or .csv file up to 100 KB." };
  }
  return { kind: "unsupported", message: "Choose a JPEG, PNG, WebP, TXT, MD or CSV file." };
}

export type ClipboardPhoto =
  | { kind: "none" }
  | { kind: "photo"; file: File }
  | { kind: "unsupported"; message: string };

/** Only real image files supplied by an explicit paste event. Don't fetch
 * clipboard URLs, parse HTML, or request background clipboard access.
 * Prefer the item representation to avoid counting the same file twice. */
export function clipboardPhoto(data: {
  items?: ArrayLike<Pick<DataTransferItem, "kind" | "type" | "getAsFile">>;
  files?: ArrayLike<File>;
}): ClipboardPhoto {
  const items = Array.from(data.items ?? []);
  const itemFiles = items
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file);
  const files = itemFiles.length ? itemFiles :
    Array.from(data.files ?? []).filter(file => file.type.startsWith("image/"));
  if (!files.length) return {kind:"none"};
  if (files.length > 1) return {kind:"unsupported",message:"Paste one image at a time."};
  const file=files[0];
  const choice=classifyCaptureAttachment(file);
  if (choice.kind === "photo") return {kind:"photo",file};
  return {kind:"unsupported",message:choice.kind === "unsupported" ? choice.message : "Paste a JPEG, PNG or WebP image."};
}

type FileTransfer = {
  types?: ArrayLike<string>;
  items?: ArrayLike<Pick<DataTransferItem, "kind" | "getAsFile">>;
  files?: ArrayLike<File>;
};

/** During dragover, file bytes and the files list may be protected. Inspect
 * only the transfer types and item kinds; never fetch a dragged URL. */
export function hasFileDrag(data: FileTransfer): boolean {
  return Array.from(data.types ?? []).includes("Files") ||
    Array.from(data.items ?? []).some(item => item.kind === "file") ||
    (data.files?.length ?? 0) > 0;
}

export type DroppedCaptureFile =
  | { kind: "none" }
  | { kind: "file"; file: File }
  | { kind: "unsupported"; message: string };

/** A single explicit local file, not a URL or HTML drop. The shared
 * attachment handler applies the same format/size rules as the picker. */
export function droppedCaptureFile(data: FileTransfer): DroppedCaptureFile {
  if (!hasFileDrag(data)) return {kind:"none"};
  const items=Array.from(data.items ?? []).filter(item=>item.kind==="file");
  const files=Array.from(data.files ?? []);
  if (items.length>1 || files.length>1) return {kind:"unsupported",message:"Drop one file at a time."};
  // The browser may expose a directory or another file item that cannot
  // be opened as a File. Do not silently accept a partial drop.
  const file=files[0] ?? items[0]?.getAsFile();
  if (!file) return {kind:"unsupported",message:"Drop a supported image or text file, not a folder."};
  return {kind:"file",file};
}
