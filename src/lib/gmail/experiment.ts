export const MAX_EXPERIMENT_DETAIL_CAP = 1_000;
export const BROADER_EXPERIMENT_WINDOWS = 120;
export const BROADER_EXPERIMENT_BATCH_WINDOWS = 5;
export const BROADER_EXPERIMENT_LIST_PAGES = 2;
export const BROADER_EXPERIMENT_LIST_PAGE_SIZE = 500;
export const BROADER_EXPERIMENT_CONCURRENCY = 5;
export const BROADER_EXPERIMENT_MAX_DETAILS_PER_BATCH = 42;
export const BROADER_EXPERIMENT_MAX_LIST_REQUESTS_PER_BATCH =
  BROADER_EXPERIMENT_BATCH_WINDOWS * 2 * BROADER_EXPERIMENT_LIST_PAGES;
export const BROADER_EXPERIMENT_REQUEST_ATTEMPTS = 3;
export const BROADER_EXPERIMENT_MAX_ATTEMPTS_PER_BATCH =
  (BROADER_EXPERIMENT_MAX_LIST_REQUESTS_PER_BATCH + BROADER_EXPERIMENT_MAX_DETAILS_PER_BATCH) *
  BROADER_EXPERIMENT_REQUEST_ATTEMPTS;

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
  const month = Math.floor(slot / 2);
  const sentBudget = Math.ceil(boundedCap / 2);
  const directionBudget = slot % 2 === 0 ? sentBudget : boundedCap - sentBudget;
  if (directionBudget === 0) return 0;
  return Math.floor(((month + 1) * directionBudget) / BROADER_EXPERIMENT_WINDOWS + 0.5) -
    Math.floor((month * directionBudget) / BROADER_EXPERIMENT_WINDOWS + 0.5);
}

export function isBroaderExperimentComplete(batchesFinished: number, failedBatches: number): boolean {
  return batchesFinished === BROADER_EXPERIMENT_WINDOWS / BROADER_EXPERIMENT_BATCH_WINDOWS && failedBatches === 0;
}
