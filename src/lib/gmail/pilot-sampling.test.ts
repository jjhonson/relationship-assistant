import { describe, expect, it } from "vitest";
import {
  formatPilotMetadataSamplingStats,
  type PilotMetadataSamplingStats,
} from "./pilot-sampling";

describe("pilot metadata sampling diagnostics", () => {
  it("formats only count-based sampling fields for the UI", () => {
    const stats: PilotMetadataSamplingStats = {
      windowsQueried: 60,
      monthWindowsQueried: 30,
      quarterWindowsQueried: 30,
      listRequests: 60,
      listRecordsReturned: 120,
      detailRequests: 60,
      recordsReturned: 60,
    };

    expect(formatPilotMetadataSamplingStats(stats)).toBe(
      "Metadata sample: 60 windows, 60 list requests, 60 detail records.",
    );
    expect(formatPilotMetadataSamplingStats(stats)).not.toMatch(
      /@|subject|thread|message id|search/i,
    );
  });
});
