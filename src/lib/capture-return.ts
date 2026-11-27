import type { CaptureEvent } from "./capture";

/** A successful scoped save need not interrupt the user's work. The
 * memory remains separately inspectable. Do not hide pending interpretation,
 * missing participants, new identities or cross-person resolution. */
export function captureAppliedToPerson(capture: CaptureEvent | null | undefined, relationshipId: string): boolean {
  return !!capture && !!relationshipId &&
    capture.status === "interpreted" &&
    capture.contextRelationshipId === relationshipId &&
    capture.people.length === 1 &&
    capture.people[0].resolution === "linked" &&
    capture.people[0].relationshipId === relationshipId;
}

/** Decide from persisted interpretation, not the requested page context
 * alone. A failed read after a successful save is not a failed save. */
export async function savedCaptureDestination(
  captureId: string,
  relationshipId: string | null | undefined,
  readCapture: (id: string) => Promise<CaptureEvent | null | undefined>,
): Promise<string> {
  const memory = "/captures/" + encodeURIComponent(captureId);
  if (!relationshipId) return memory;
  try {
    const capture = await readCapture(captureId);
    if (capture?.id !== captureId || !captureAppliedToPerson(capture, relationshipId)) return memory;
    return "/relationships/" + encodeURIComponent(relationshipId) + "?memorySaved=" + encodeURIComponent(captureId);
  } catch {
    // The saved memory is still the safest place to inspect the result.
    return memory;
  }
}
