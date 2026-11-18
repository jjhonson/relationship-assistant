import { describe, expect, it, vi } from "vitest";
import { MAX_CAPTURE_IMAGE_BYTES, observeCaptureImageWithOpenAI, PHOTO_SYSTEM_PROMPT, validateCaptureImage } from "./capture-image";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const webp = new Uint8Array(Buffer.from("RIFF1234WEBPstuff"));

describe("intentional photo capture", () => {
  it("accepts only size-bounded JPEG, PNG, or WebP data with matching magic bytes", () => {
    expect(() => validateCaptureImage(jpeg, "image/jpeg")).not.toThrow();
    expect(() => validateCaptureImage(png, "image/png")).not.toThrow();
    expect(() => validateCaptureImage(webp, "image/webp")).not.toThrow();
    expect(() => validateCaptureImage(jpeg, "image/png")).toThrow("not supported");
    expect(() => validateCaptureImage(new Uint8Array([1, 2, 3]), "image/jpeg")).toThrow("not supported");
    expect(() => validateCaptureImage(new Uint8Array(MAX_CAPTURE_IMAGE_BYTES + 1), "image/jpeg")).toThrow("smaller than 4 MB");
  });

  it("sends an ephemeral image with storage disabled and preserves separate visible text and observations", async () => {
    const result = { sourceText: "Happy holidays!\nFrom Arvin and Cindy", visualDetails: "A white dog sitting in a car." };
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.reasoning).toEqual({ effort: "medium" });
      expect(body.instructions).toBe(PHOTO_SYSTEM_PROMPT);
      expect(body.input).toHaveLength(1);
      expect(body.input[0].content[0].text).toContain("User's optional context");
      expect(body.input[0].content[0].text).toContain("old friend Arvin");
      const image = body.input[0].content[1];
      expect(image.type).toBe("input_image");
      expect(image.detail).toBe("high");
      expect(image.image_url).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`);
      expect(body.text.format.strict).toBe(true);
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] }));
    });
    expect(await observeCaptureImageWithOpenAI({
      bytes: jpeg, mimeType: "image/jpeg", note: "Holiday card from old friend Arvin",
    }, { apiKey: "test-key", fetchImpl: fetchImpl as typeof fetch })).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses empty interpretations or provider failures without echoing raw provider content", async () => {
    const input = { bytes: jpeg, mimeType: "image/jpeg", note: "" };
    await expect(observeCaptureImageWithOpenAI(input, { apiKey: "" })).rejects.toThrow("configured");
    await expect(observeCaptureImageWithOpenAI(input, {
      apiKey: "test-key", fetchImpl: vi.fn(async () => new Response("private image data", { status: 500 })) as typeof fetch,
    })).rejects.not.toThrow("private image data");
    await expect(observeCaptureImageWithOpenAI(input, {
      apiKey: "test-key", fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify({ sourceText: "", visualDetails: "" }) }] }],
      }))) as typeof fetch,
    })).rejects.toThrow("did not yield usable information");
    await expect(observeCaptureImageWithOpenAI(input, {
      apiKey: "test-key", fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "refusal" }] }],
      }))) as typeof fetch,
    })).rejects.toThrow("declined");
  });
});
