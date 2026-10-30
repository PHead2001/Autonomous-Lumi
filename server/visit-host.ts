import { validateSocialCommand, type SocialIntentCommand } from '../shared/social-protocol.js';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { BranchRegistry } from './branch-registry.js';
import type { BranchRuntime } from './branch-runtime.js';
import type { ActiveTarget } from '../shared/lab-protocol.js';
import { validateVisitCommand, type VisitStopCommand } from '../shared/visit-protocol.js';
import { OwnerAuth, ownerCookie, type OwnerSession } from './owner-auth.js';

interface Controller { session: OwnerSession; runtime: BranchRuntime; generation: number; sequence: number; socket?: WebSocket }
const same = (a: ActiveTarget, b: ActiveTarget) => a.worldId === b.worldId && a.branchId === b.branchId && a.runId === b.runId;
const exact = (raw: Record<string, unknown>, fields: string[]) => Object.keys(raw).sort().join(',') === fields.sort().join(',');
/** Dedicated authenticated transport. No auth identity crosses the ordered simulation boundary. */
export class VisitHost {
  private controllers = new Map<string, Controller>();
  private bindings = new Map<WebSocket, Controller>();
  constructor(readonly auth: OwnerAuth, private registry: BranchRegistry, private scope: (value: Record<string, unknown>) => ActiveTarget) {}
  private key(target: ActiveTarget) { return `${target.worldId}/${target.branchId}`; }
  private write(socket: WebSocket, value: unknown) { if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 64000) return; try { socket.send(JSON.stringify(value), () => {}); } catch { /* Disconnect safety is owned by the close handler and fixed-tick expiry. */ } }
  private stop(controller: Controller, reason: VisitStopCommand['reason']): void {
    if (this.controllers.get(this.key(controller.runtime.target)) !== controller) return;
    controller.runtime.enqueueVisit({ type: 'visit_stop', runId: controller.runtime.target.runId, generation: controller.generation, reason });
    this.controllers.delete(this.key(controller.runtime.target));
    if (controller.socket) { this.bindings.delete(controller.socket); this.write(controller.socket, { type: 'error', error: 'Visit control ended; avatar parked' }); controller.socket.close(1000, 'Control ended'); }
  }
  retire(runtime: BranchRuntime): void { const controller = this.controllers.get(this.key(runtime.target)); if (controller?.runtime === runtime) this.stop(controller, 'revoked'); }
  status(req: IncomingMessage) { const session = this.auth.session(req.headers.cookie); return { authenticated: !!session, configured: this.auth.configured, ...(session ? { csrf: session.csrf } : {}) }; }
  post(path: string, req: IncomingMessage, input: Record<string, unknown>): { value: unknown; cookie?: string } {
    if (path === '/api/visit/login') {
      if (!exact(input, ['credential'])) throw new Error('Owner login failed');
      const session = this.auth.login(input.credential);
      return { value: { authenticated: true, configured: true, csrf: session.csrf }, cookie: ownerCookie(session) };
    }
    const session = this.auth.require(req.headers.cookie, input.csrf);
    const scope = this.scope(input), runtime = this.registry.active(scope), key = this.key(scope);
    if (path === '/api/visit/observe') {
      if (!exact(input, ['worldId', 'branchId', 'runId', 'csrf'])) throw new Error('Invalid Visit request');
      const controller = this.controllers.get(key);
      if (controller && controller.session.id !== session.id) throw new Error('Another session controls Visit');
      if (controller) this.stop(controller, 'observe');
      return { value: { parked: true } };
    }
    if (path !== '/api/visit/enter' || !exact(input, ['worldId', 'branchId', 'runId', 'csrf', ...(input.takeover === undefined ? [] : ['takeover'])]) || input.takeover !== undefined && typeof input.takeover !== 'boolean') throw new Error('Invalid Visit request');
    const existing = this.controllers.get(key);
    if (existing && input.takeover !== true) throw new Error('Visit is controlled in another tab. Use Take over to park its control and continue.');
    if (existing) this.stop(existing, 'revoked');
    const checkpoint = runtime.simulation.checkpoint();
    if ((checkpoint.schemaVersion!==10&&checkpoint.schemaVersion!==11)) throw new Error('Visit requires the current world schema');
    const pendingGeneration = Math.max(checkpoint.visit.control.generation, ...checkpoint.pendingInputs.map(i => i.command.type === 'visit_start' ? i.command.generation : 0));
    const generation = pendingGeneration + 1;
    const accepted = runtime.enqueueVisit({ type: 'visit_start', runId: scope.runId, generation });
    if (accepted.input.admission !== 'queued') throw new Error('Visit is busy; retry shortly');
    const controller: Controller = { session, runtime, generation, sequence: 0 };
    this.controllers.set(key, controller);
    return { value: { generation, lastSequence: 0, lastActionId: checkpoint.visit.lastActionId, actor: runtime.viewerState().visit } };
  }
  connect(socket: WebSocket, req: IncomingMessage): void {
    socket.on('error', () => {});
    socket.on('close', () => { const controller = this.bindings.get(socket); if (controller) this.stop(controller, 'disconnect'); });
    socket.on('message', raw => {
      try {
        const input = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Visit input');
        if (input.type === 'bind') {
          if (this.bindings.has(socket) || !exact(input, ['type', 'worldId', 'branchId', 'runId', 'csrf', 'generation'])) throw new Error('Invalid Visit binding');
          const session = this.auth.require(req.headers.cookie, input.csrf), scope = this.scope(input), controller = this.controllers.get(this.key(scope));
          if (!controller || controller.session.id !== session.id || controller.socket || controller.generation !== input.generation || !same(controller.runtime.target, scope) || this.registry.active(scope) !== controller.runtime) throw new Error('Visit control unavailable');
          controller.socket = socket; this.bindings.set(socket, controller); this.write(socket, { type: 'bound', generation: controller.generation }); return;
        }
        const controller = this.bindings.get(socket);
        if (!controller || this.auth.session(req.headers.cookie)?.id !== controller.session.id || this.registry.active(this.scope(input)) !== controller.runtime || input.generation !== controller.generation || !Number.isSafeInteger(input.sequence) || Number(input.sequence) <= controller.sequence) throw new Error('Visit control is stale or unavailable');
        const shared = ['type', 'worldId', 'branchId', 'runId', 'generation', 'sequence'];
        let command;let social:SocialIntentCommand|undefined;
        if (input.type === 'control' && exact(input, [...shared, 'forward', 'strafe', 'yaw', 'pitch'])) command = validateVisitCommand({ type: 'visit_control', runId: controller.runtime.target.runId, generation: input.generation, sequence: input.sequence, forward: input.forward, strafe: input.strafe, yaw: input.yaw, pitch: input.pitch, expiresTick: controller.runtime.simulation.state.tick + Math.ceil(.75 * controller.runtime.simulation.checkpoint().config.hz) });
        else if (input.type === 'interact' && exact(input, [...shared, 'actionId', 'action', 'door', 'good'])) command = validateVisitCommand({ type: 'visit_interact', runId: controller.runtime.target.runId, generation: input.generation, sequence: input.sequence, actionId: input.actionId, action: input.action, door: input.door, good: input.good });
        else if ((input.type==='offer'&&exact(input,[...shared,'actionId','itemId']))||(input.type==='cancel_offer'&&exact(input,[...shared,'actionId','offerId']))||(input.type==='badge'&&exact(input,[...shared,'actionId','display']))){const normalized=validateSocialCommand({type:input.type==='offer'?'social_offer':input.type==='cancel_offer'?'social_cancel':'social_badge',runId:controller.runtime.target.runId,generation:input.generation,sequence:input.sequence,actionId:input.actionId,...(input.type==='offer'?{itemId:input.itemId}:input.type==='cancel_offer'?{offerId:input.offerId}:{display:input.display})});if(normalized.type==='social_observation')throw new Error('Social intention required');social=normalized;}
        else throw new Error('Invalid Visit control fields');
        const result = social?controller.runtime.enqueueSocial(social):controller.runtime.enqueueVisit(command!);
        controller.sequence = Number(input.sequence);
        this.write(socket, { type: 'ack', sequence: input.sequence, queued: result.input.admission === 'queued' });
      } catch { this.write(socket, { type: 'error', error: 'Visit input rejected; check connection and current control' }); }
    });
  }
  broadcast(): void {
    for (const controller of this.controllers.values()) {
      if (!this.auth.session(`lumi_owner=${controller.session.id}`)) { this.stop(controller, 'revoked'); continue; }
      if (controller.socket) this.write(controller.socket, { type: 'state', state: controller.runtime.viewerState() });
    }
  }
  close(): void { for (const controller of [...this.controllers.values()]) this.stop(controller, 'revoked'); this.auth.close(); }
}
