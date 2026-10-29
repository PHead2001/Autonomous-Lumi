import type { ActiveTarget } from './lab-protocol.js';
import type { AutomaticCaptureReason } from './attention-protocol.js';

/** Admission includes the running job. Each admitted slot may consume one full render deadline. */
export const CAPTURE_LIMITS = { capacity: 4, timeoutMs: 20000, cleanupTimeoutMs: 5000 } as const;
export interface CaptureCompletionTiming { capacity: number; timeoutMs: number; cleanupTimeoutMs: number; transportSlackMs: number }
export const CAPTURE_COMPLETION_TIMING: CaptureCompletionTiming = { ...CAPTURE_LIMITS, transportSlackMs: 5000 };
/** Shared by CLI and dashboard: every admitted slot can render and clean up before this result arrives. */
export function captureResultDeadlineMs(timing: CaptureCompletionTiming = CAPTURE_COMPLETION_TIMING): number {
  if (!Number.isSafeInteger(timing.capacity) || timing.capacity < 1 || !Number.isSafeInteger(timing.timeoutMs) || timing.timeoutMs < 1 || !Number.isSafeInteger(timing.cleanupTimeoutMs) || timing.cleanupTimeoutMs < 1 || !Number.isSafeInteger(timing.transportSlackMs) || timing.transportSlackMs < 1) throw new Error('Invalid bounded capture client timing');
  const result = timing.capacity * (timing.timeoutMs + timing.cleanupTimeoutMs) + timing.transportSlackMs;
  if (!Number.isSafeInteger(result) || result > 0x7fffffff) throw new Error('Capture client deadline exceeds the timer bound');
  return result;
}
export type RendererBackend = 'angle-d3d11' | 'swiftshader';
export type CaptureStatus = 'queued' | 'pending' | 'success' | 'unavailable' | 'timeout' | 'failed' | 'stale';
export const MANUAL_CAPTURE_REASONS = ['developer', 'diagnostic', 'benchmark'] as const;
export type CaptureReason = typeof MANUAL_CAPTURE_REASONS[number] | AutomaticCaptureReason;
export interface CaptureOptions { reason: CaptureReason; width?: number; height?: number }
export interface AutomaticCaptureAssociation { intentId: number; reasons: AutomaticCaptureReason[]; parentSequence: number | null }
export interface CameraEvidence {
  position: [number, number, number]; direction: [number, number, number]; up: [number, number, number];
  bodyHeading: number; headYaw: number; headPitch: number; horizontalFovDegrees: number; verticalFovDegrees: number;
  width: number; height: number; near: number; far: number;
}
export interface RendererIdentity { configuration: RendererBackend; chromium: string; webglVendor: string; webglRenderer: string; version: string; flags: string[] }
export interface CaptureMetadata extends ActiveTarget {
  captureId: string; observationId: string; tick: number; stateVersion: number; stateHash: string;
  sceneRevision: string; dynamicRevision: number; renderRevision: string;
  camera: CameraEvidence; reason: CaptureOptions['reason']; width: number; height: number; format: 'image/png';
  status: CaptureStatus; requestedAt: string; completedAt: string | null; durationMs: number | null;
  frameHash: string | null; backend: RendererIdentity | null; error: string | null;
  automatic?: AutomaticCaptureAssociation;
}
export type SampleVisibilityBand = 'low' | 'medium' | 'high';
export interface EligibleShape {
  handle: string; identity: 'unknown'; bearingDegrees: number; elevationDegrees: number;
  distanceBand: string; sampleVisibilityBand: SampleVisibilityBand; qualityFlags: string[]; uncertainty: 'geometric_samples_only';
}
/** Deliberately excludes engine identities, exact world positions, and hidden objects. */
export interface VisualObservation extends ActiveTarget {
  observationId: string; tick: number; stateVersion: number; sceneRevision: string; dynamicRevision: number;
  frameHash: string; camera: CameraEvidence; shapes: EligibleShape[];
  interpretation: 'uninterpreted sensor evidence'; experienceEncoded: false;
}
export interface CaptureView {
  latest: CaptureMetadata | null; previousSuccess: CaptureMetadata | null;
  observation: VisualObservation | null; privateGrounding: unknown | null;
  cleanupError: string | null;
  limits: { queued: number; capacity: number; retainedFrames: number; maxRetainedFrames: number; timeoutMs: number };
}
