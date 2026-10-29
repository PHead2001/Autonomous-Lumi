import type { ActiveTarget } from './lab-protocol.js';

export type RendererBackend = 'angle-d3d11' | 'swiftshader';
export type CaptureStatus = 'queued' | 'pending' | 'success' | 'unavailable' | 'timeout' | 'failed' | 'stale';
export interface CaptureOptions { reason: 'developer' | 'diagnostic' | 'benchmark'; width?: number; height?: number }
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
}
export interface EligibleShape {
  handle: string; identity: 'unknown'; bearingDegrees: number; elevationDegrees: number;
  distanceBand: string; sampleVisibilityFraction: number; qualityFlags: string[]; uncertainty: 'geometric_samples_only';
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
