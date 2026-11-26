export type DatasetMode = "fictional" | "personal";
export type DatasetProfile = { mode: DatasetMode; base: string; secret: string; ownerId: string };
export function getDatasetMode(env?: NodeJS.ProcessEnv): DatasetMode;
export function resolveDatasetProfile(env?: NodeJS.ProcessEnv): DatasetProfile;
export function assertDatasetPurpose(document: unknown, mode: DatasetMode): void;
export function prepareDatasetForWrite(document: unknown, mode: DatasetMode, previousRevision: number): unknown;
