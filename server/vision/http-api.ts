import type { BranchRegistry } from '../branch-registry.js';
import type { BranchRuntime } from '../branch-runtime.js';
import { validId } from '../branch-runtime.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import { CaptureManager } from './capture-manager.js';
import type { FrameRenderer } from './renderer.js';

function target(query: Record<string, unknown>): ActiveTarget {
  if (![query.worldId, query.branchId, query.runId].every(validId)) throw new Error('Explicit vision world, branch and run required');
  return { worldId: query.worldId as string, branchId: query.branchId as string, runId: query.runId as string };
}
/** Caller must apply its local Host/Origin gate to GET and POST before calling these handlers. */
export function createVisionApi({ registry, renderer }: { registry: BranchRegistry; renderer?: FrameRenderer }) {
  // Restore preparation blocks new commands, but the old run still owns its world until the swap commits.
  const manager = new CaptureManager(scope => { try { return registry.get(scope).target.runId === scope.runId; } catch { return false; } }, renderer);
  return {
    manager,
    async get(pathname: string, query: Record<string, unknown>): Promise<{ status: number; body?: unknown; bytes?: Uint8Array; contentType?: string } | null> {
      if (!['/api/vision', '/api/vision/frame', '/api/vision/result'].includes(pathname)) return null;
      const scope = target(query); registry.active(scope);
      if (pathname === '/api/vision') return { status: 200, body: manager.view(scope) };
      if (!validId(query.captureId)) throw new Error('Invalid capture ID');
      if (pathname === '/api/vision/result') { const result = await manager.wait(scope, query.captureId); registry.active(scope); return { status: 200, body: result }; }
      return { status: 200, bytes: manager.frame(scope, query.captureId), contentType: 'image/png' };
    },
    async post(pathname: string, runtime: BranchRuntime, input: Record<string, unknown>): Promise<object | null> {
      if (pathname === '/api/vision/capture') return manager.request(runtime, { reason: input.reason as 'developer', ...(input.width === undefined ? {} : { width: input.width as number }), ...(input.height === undefined ? {} : { height: input.height as number }) });
      if (pathname === '/api/vision/head') { const action = manager.resolveHeadAction(runtime, input.action); const result = runtime.enqueue(action); return { input: result.input, state: runtime.viewerState() }; }
      return null;
    },
    close: () => manager.close(),
  };
}
