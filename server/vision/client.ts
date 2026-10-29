import { CAPTURE_LIMITS, type CaptureMetadata } from '../../shared/capture-protocol.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';

interface ClientTiming { capacity: number; timeoutMs: number; cleanupTimeoutMs: number; transportSlackMs: number }
const DEFAULT_TIMING: ClientTiming = { ...CAPTURE_LIMITS, transportSlackMs: 5000 };
/** An admitted request can wait behind every other slot, then use its own complete render budget. */
export function captureResultDeadlineMs(timing: ClientTiming = DEFAULT_TIMING): number {
  if (!Number.isSafeInteger(timing.capacity) || timing.capacity < 1 || !Number.isSafeInteger(timing.timeoutMs) || timing.timeoutMs < 1 || !Number.isSafeInteger(timing.cleanupTimeoutMs) || timing.cleanupTimeoutMs < 1 || !Number.isSafeInteger(timing.transportSlackMs) || timing.transportSlackMs < 1) throw new Error('Invalid bounded capture client timing');
  const result = timing.capacity * (timing.timeoutMs + timing.cleanupTimeoutMs) + timing.transportSlackMs;
  if (!Number.isSafeInteger(result) || result > 0x7fffffff) throw new Error('Capture client deadline exceeds the timer bound');
  return result;
}
/** Used by the CLI. Timing injection permits a short real-HTTP queue regression without an 80s test. */
export async function captureFromServer(url: URL, scope: ActiveTarget, size = 512, timing: ClientTiming = DEFAULT_TIMING): Promise<{ metadata: CaptureMetadata; bytes: Uint8Array }> {
  const resultDeadline = captureResultDeadlineMs(timing);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Vision CLI requires a local HTTP server');
  const request = await fetch(new URL('/api/vision/capture', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, reason: 'diagnostic', width: size, height: size }), signal: AbortSignal.timeout(timing.timeoutMs + timing.transportSlackMs) });
  const submitted = await request.json() as CaptureMetadata & { error?: string }; if (!request.ok) throw new Error(submitted.error ?? 'Capture request failed');
  const query = new URLSearchParams({ ...scope, captureId: submitted.captureId });
  const result = await fetch(new URL('/api/vision/result?' + query, url), { signal: AbortSignal.timeout(resultDeadline) });
  const metadata = await result.json() as CaptureMetadata & { error?: string };
  if (!result.ok || metadata.status !== 'success') throw new Error(metadata.error ?? 'Capture did not succeed');
  const frame = await fetch(new URL('/api/vision/frame?' + query, url), { signal: AbortSignal.timeout(timing.transportSlackMs) }); if (!frame.ok) throw new Error('Frame unavailable for current run');
  return { metadata, bytes: new Uint8Array(await frame.arrayBuffer()) };
}
