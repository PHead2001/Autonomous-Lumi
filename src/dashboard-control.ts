import type { ControlAction } from '../shared/lab-protocol';

/** Read and validate form values before an operation's busy render can refresh them. */
export async function runCapturedControl(read: () => ControlAction, start: (payload: ControlAction) => Promise<void>): Promise<void> {
  const payload = structuredClone(read());
  await start(payload);
}
