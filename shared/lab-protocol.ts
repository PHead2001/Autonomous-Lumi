export interface Target { worldId: string; branchId: string }
export interface ActiveTarget extends Target { runId: string }
export type WorldMode = 'LIVE' | 'EXPERIMENT';
export type ControlAction =
  | { type: 'pause' | 'resume' | 'step' | 'cancel-fast-forward' | 'activity-pause' | 'activity-resume' }
  | { type: 'speed'; speed: number }
  | { type: 'fast-forward'; ticks: number }
  | { type: 'activity-start'; totalTicks: number }
  | { type: 'logging'; mode: 'off' | 'default' | 'verbose'; compressClosed: boolean }
  | { type: 'synthetic-cue'; sensed: boolean; attended: boolean; encoded: boolean }
  | { type: 'synthetic-clock'; sensed: boolean; attended: boolean; encoded: boolean; observedSeconds: number; uncertaintySeconds: number };
export interface SubjectiveClock { estimateSeconds: number; uncertaintySeconds: number; lastCalibrationTick: number | null; driftPpm: number; uncertaintyGrowthPerSecond: number }
export interface ActivityState { status: 'idle' | 'running' | 'paused' | 'complete'; cursor: number; totalTicks: number; appliedMilestones: number[]; completionCount: number; activityId: number }
export interface BranchSummary extends ActiveTarget {
  mode: WorldMode; tick: number; time: number; paused: boolean; speed: number; fastForwardRemaining: number;
  subjective: SubjectiveClock; activity: ActivityState; stateHash: string; eventHash: string; runtimeHash: string;
  checkpoint: { id: string; tick: number }; checkpoints: { id: string; tick: number }[]; runs: string[];
  logging: unknown; worldSecondsPerModelResponse: null;
}
