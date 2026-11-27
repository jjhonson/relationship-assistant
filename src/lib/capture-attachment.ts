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
