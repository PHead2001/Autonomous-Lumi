export interface PendingRestoredRun { targetKey: string; runId: string }

/** Select evidence within one branch without consuming another branch's restore. */
export function selectTimelineRun(options: {
  targetKey: string;
  currentRunId: string;
  availableRuns: readonly string[];
  selectedRunId: string;
  pendingRestore?: PendingRestoredRun;
}): { selectedRunId: string; pendingRestore: PendingRestoredRun | undefined } {
  const pending = options.pendingRestore?.targetKey === options.targetKey ? options.pendingRestore : undefined;
  const preferred = pending?.runId ?? (options.selectedRunId || options.currentRunId);
  const selectedRunId = options.availableRuns.includes(preferred) ? preferred : options.availableRuns[0] ?? '';
  return {
    selectedRunId,
    pendingRestore: pending && selectedRunId === pending.runId ? undefined : options.pendingRestore,
  };
}
