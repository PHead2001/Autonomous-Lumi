import { EXPERIMENT_PLAYBACK, type PlaybackReport } from '../shared/lab-protocol';

const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Presentation never substitutes the requested multiplier for a measurement. */
export function playbackPresentation(report: PlaybackReport): { requested: string; achieved: string; detail: string; warning: boolean } {
  const requested = `Requested ${amount(report.requestedSpeed)}×`;
  const exceptional = {
    paused: 'Paused · no playback measurement',
    fast_forward: 'Fast-forwarding · separate bounded operation',
    suspended: 'Host suspension observed · collecting a new sample',
    insufficient_sample: 'Collecting a playback sample',
  };
  const measured = report.status === 'running' && report.achievedSpeed !== null && Number.isFinite(report.achievedSpeed);
  const achieved = measured ? `Achieved ${amount(report.achievedSpeed!)}×` : 'Achieved —';
  const detail = measured
    ? `${amount(report.sampleWorldSeconds)} world seconds / ${amount(report.sampleHostSeconds)} measured host seconds.`
    : report.status === 'running' ? 'No valid playback measurement available.' : exceptional[report.status];
  const notices = [
    report.catchupLostSeconds > 0 ? `${amount(report.catchupLostSeconds)} world seconds of catch-up discarded in this run.` : '',
    report.underperforming ? 'Sustained playback is below the requested speed.' : '',
  ].filter(Boolean);
  return { requested, achieved, detail: [detail, ...notices].join(' '), warning: notices.length > 0 };
}

export function parsePlaybackSpeed(input: string): number {
  const speed = Number(input);
  if (!input.trim() || !Number.isFinite(speed) || speed < 1 || speed > EXPERIMENT_PLAYBACK.maxSpeed) {
    throw new Error(`Playback speed must be between 1× and ${EXPERIMENT_PLAYBACK.maxSpeed}×. Use Fast-forward for separate bounded work.`);
  }
  return speed;
}
