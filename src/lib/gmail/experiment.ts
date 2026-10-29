export const MAX_EXPERIMENT_DETAIL_CAP = 1_000;
export const BROADER_EXPERIMENT_WINDOWS = 120;
export const BROADER_EXPERIMENT_BATCH_WINDOWS = 5;
export const BROADER_EXPERIMENT_LIST_PAGES = 2;
export const BROADER_EXPERIMENT_MAX_ATTEMPTS_PER_BATCH = 210;

export type BroaderExperimentStats = {
  windowsQueried: number;
  listBucketsQueried: number;
  plannedDetails: number;
  recordsFetched: number;
  duplicateIds: number;
  failedListBuckets: number;
  failedDetails: number;
  apiRequests: number;
  listRequests: number;
  detailRequests: number;
};

export function broaderExperimentQuota(cap: number, slot: number): number {
  const boundedCap = Math.max(1, Math.min(Math.floor(cap), MAX_EXPERIMENT_DETAIL_CAP));
  if (!Number.isInteger(slot) || slot < 0 || slot >= BROADER_EXPERIMENT_WINDOWS * 2) return 0;
  return Math.floor(((slot + 1) * boundedCap) / (BROADER_EXPERIMENT_WINDOWS * 2)) -
    Math.floor((slot * boundedCap) / (BROADER_EXPERIMENT_WINDOWS * 2));
}

export function isBroaderExperimentComplete(batchesFinished: number, failedBatches: number): boolean {
  return batchesFinished === BROADER_EXPERIMENT_WINDOWS / BROADER_EXPERIMENT_BATCH_WINDOWS && failedBatches === 0;
}
