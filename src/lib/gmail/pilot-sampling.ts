export type PilotMetadataSamplingStats = {
  listRequests: number;
  listRecordsReturned: number;
  detailRequests: number;
  windowsQueried: number;
  monthWindowsQueried: number;
  quarterWindowsQueried: number;
  recordsReturned: number;
};

export function formatPilotMetadataSamplingStats(stats: PilotMetadataSamplingStats): string {
  return `Metadata sample: ${stats.windowsQueried} windows, ${stats.listRequests} list requests, ${stats.recordsReturned} detail records.`;
}
