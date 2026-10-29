import type { ActiveTarget } from '../shared/lab-protocol';
import type { CognitionAction, CognitionActionOutcome, CognitionMetrics } from '../shared/cognition-protocol';
import { visionScopeKey } from './dashboard-vision';

export interface CognitionRequestView {
  requestId: string; observationId: string; captureId?: string; frameHash: string;
  purpose?: 'interpretation' | 'decisions_evaluation'; capturedTick: number; attentionTick: number; requestedTick: number;
  provider: string; model: string; status: 'pending' | 'completed'; resultTick: number | null;
  outcome: string | null; interpretation: string | null; uncertainty: number | null;
  proposedAction: CognitionAction | null; action: CognitionActionOutcome | null;
  encoding: { status: 'admitted' | 'rejected' | 'failed'; reason: string; experienceId: number | null } | null;
  metrics: CognitionMetrics | null;
}
export interface CognitionView extends ActiveTarget {
  configuration: { main: { enabled: boolean; available: boolean; model: string }; decisions: { enabled: boolean; available: boolean; model: string }; limits: Record<string, number>; budget: { ceilingUsd: number }; retries: number };
  providers: Record<string, unknown>; budget: unknown; lastFailure: string | null;
  decisions: { status: string; liveEnabled: boolean }; pending: number;
  worldSecondsPerModelResponse: number | null; metricDefinition: string; requests: CognitionRequestView[];
}

/** A delayed API response must never become the newly selected branch's evidence. */
export function validateCognitionViewScope(view: CognitionView, target: ActiveTarget): void {
  if (visionScopeKey(view) !== visionScopeKey(target)) throw new Error('Cognition evidence does not match the selected world, branch and run.');
  if (!Array.isArray(view.requests) || view.requests.length > 16 || new Set(view.requests.map(item => item.requestId)).size !== view.requests.length) throw new Error('Cognition evidence contains an invalid bounded request list.');
}
export function selectCognitionRequest(requests: CognitionRequestView[], preferred: string): CognitionRequestView | null {
  return requests.find(item => item.requestId === preferred) ?? requests.at(-1) ?? null;
}
/** Uses the bound capture, never the latest frame. Older API records used captureId as observationId. */
export function cognitionFrameUrl(target: ActiveTarget, request: CognitionRequestView): string {
  const captureId = request.captureId ?? request.observationId;
  if (![target.worldId, target.branchId, target.runId, captureId].every(value => /^[A-Za-z0-9_-]{1,100}$/.test(value)) || !/^[a-f0-9]{64}$/.test(request.frameHash)) throw new Error('Associated cognition frame has invalid identity.');
  return `/api/vision/frame?${new URLSearchParams({ ...target, captureId })}`;
}
export function modelResponseMetric(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} s` : 'N/A';
}
export function cognitionActionLabel(action: CognitionActionOutcome | null): string {
  if (!action) return 'No local action validation/execution outcome yet.';
  return action.status === 'executed' ? `Started / queued at tick ${action.tick}: ${action.reason}${action.actionId === null ? '' : ` · action ${action.actionId}`}. This does not establish physical completion.` : `Rejected at tick ${action.tick}: ${action.reason}. No proposed action was executed.`;
}
