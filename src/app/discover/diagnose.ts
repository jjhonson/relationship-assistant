"use server";

import { cookies } from "next/headers";
import { loadConfig } from "@/lib/gmail/config";
import { diagnoseAddress, type ProbeReport } from "@/lib/gmail/discovery";
import { fetchAddressLookup, fetchDiscoverySample, fetchOwnerAddress, isLookupAddress, LOOKUP_LIMIT } from "@/lib/gmail/messages";
import { AuthError } from "@/lib/gmail/oauth";
import { CRED_COOKIE, readCreds } from "@/lib/gmail/session";

/** Contains no address and nothing from the mailbox beyond counts. */
export type LookupSummary = { returned: number; headersMatching: number; directOneToOne: number; truncated: boolean; limit: number };
export type DiagnoseState =
  | null
  | { kind: "error"; message: string }
  | { kind: "report"; report: ProbeReport; lookup: LookupSummary | null };

/**
 * Development-only positive-control diagnostic. The address arrives in a POST body, is compared
 * in memory against a fresh discovery run, and is never logged, persisted, or echoed back.
 */
export async function diagnoseAction(_previous: DiagnoseState, formData: FormData): Promise<DiagnoseState> {
  if (process.env.NODE_ENV !== "development") return { kind: "error", message: "The diagnostic is only available in local development." };
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  if (!isLookupAddress(address)) return { kind: "error", message: "Enter a single plain email address." };

  const cfg = loadConfig();
  const creds = cfg.ok ? readCreds((await cookies()).get(CRED_COOKIE)?.value, cfg.config.sessionSecret) : null;
  if (!cfg.ok || !creds || creds.expiresAt - 60_000 < Date.now()) {
    return { kind: "error", message: "Gmail is not connected or the session expired. Reload the page and reconnect." };
  }

  try {
    const owner = await fetchOwnerAddress(creds.accessToken);
    const ownerAddresses = owner ? [owner] : [];
    const { messages } = await fetchDiscoverySample(creds.accessToken, cfg.config.discoverySampleSize, new Date(), ownerAddresses);
    const report = diagnoseAddress(messages, address, 10, { ownerAddresses });

    let lookup: LookupSummary | null = null;
    if (report.status === "not-sampled" && formData.get("lookup") === "on") {
      const found = await fetchAddressLookup(creds.accessToken, address);
      const summary = diagnoseAddress(found.messages, address, 10, { ownerAddresses });
      lookup = {
        returned: found.messages.length,
        headersMatching: summary.messagesMentioning,
        directOneToOne: summary.outcomes.counted,
        truncated: found.truncated,
        limit: LOOKUP_LIMIT,
      };
    }
    return { kind: "report", report, lookup };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof AuthError ? "Your Gmail session expired or was revoked. Reconnect to continue." : "Gmail could not be reached right now.",
    };
  }
}
