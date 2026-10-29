/** Keeps the user's connection preference separate from temporary page suspension. */
export class ViewerLifecycle {
  private wantsConnection = true;
  private suspended = false;

  constructor(page: EventTarget, private readonly transport: { resume(): void; suspend(): void }) {
    page.addEventListener('pagehide', () => {
      this.suspended = true;
      this.transport.suspend();
    });
    page.addEventListener('pageshow', event => {
      if (!(event as PageTransitionEvent).persisted || !this.suspended) return;
      this.suspended = false;
      if (this.wantsConnection) this.transport.resume();
    });
  }

  get shouldReconnect(): boolean { return this.wantsConnection && !this.suspended; }

  connect(): void {
    this.wantsConnection = true;
    if (!this.suspended) this.transport.resume();
  }

  disconnect(): void {
    this.wantsConnection = false;
    this.transport.suspend();
  }
}
