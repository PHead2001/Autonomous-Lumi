export class SlamAudio {
  private context: AudioContext | null = null;
  async activate(): Promise<boolean> {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }
  playBell(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    for (const [offset, frequency] of [[0, 784], [.2, 622]] as const) {
      const tone = context.createOscillator(), gain = context.createGain();
      tone.type = 'sine'; tone.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, now + offset); gain.gain.exponentialRampToValueAtTime(.18, now + offset + .015); gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .7);
      tone.connect(gain); gain.connect(context.destination); tone.start(now + offset); tone.stop(now + offset + .72);
    }
  }
  play(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const gain = context.createGain(); gain.gain.setValueAtTime(0.6, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35); gain.connect(context.destination);
    const length = Math.floor(context.sampleRate * 0.3), buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.045));
    const noise = context.createBufferSource(); noise.buffer = buffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1700;
    noise.connect(filter); filter.connect(gain); noise.start(now); noise.stop(now + 0.3);
    const thud = context.createOscillator(); thud.frequency.setValueAtTime(105, now); thud.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    thud.connect(gain); thud.start(now); thud.stop(now + 0.25);
  }
}
