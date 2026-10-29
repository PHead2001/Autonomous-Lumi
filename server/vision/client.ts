import { CAPTURE_COMPLETION_TIMING, captureResultDeadlineMs, type CaptureCompletionTiming, type CaptureMetadata } from '../../shared/capture-protocol.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';

export { captureResultDeadlineMs } from '../../shared/capture-protocol.js';
/** Used by the CLI. Timing injection permits a short real-HTTP queue regression without an 80s test. */
export async function captureFromServer(url: URL, scope: ActiveTarget, size = 512, timing: CaptureCompletionTiming = CAPTURE_COMPLETION_TIMING): Promise<{ metadata: CaptureMetadata; bytes: Uint8Array }> {
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
