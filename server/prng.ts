/** xorshift32 v1. Zero is rejected because it is an absorbing state. */
export class SeededRandom {
  private value: number;
  constructor(readonly seed: number, state = seed) {
    if (![seed, state].every(v => Number.isInteger(v) && v > 0 && v <= 0xffffffff)) throw new Error('Invalid PRNG seed/state');
    this.value = state;
  }
  next(): number { let x = this.value; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.value = x >>> 0; return this.value / 0x100000000; }
  get state(): number { return this.value; }
}
