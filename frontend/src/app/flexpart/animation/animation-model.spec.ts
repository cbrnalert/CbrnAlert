import { animationColorbar, nextFrame, playbackRange, timeMillis } from './animation-model';

describe('Animation timeline', () => {
  const times = ['2026-01-10T01:00:00', '2026-01-10T02:00:00', '2026-01-10T03:00:00'];
  it('interprets model timestamps as UTC', () => {
    expect(timeMillis(times[0])).toBe(Date.parse('2026-01-10T01:00:00Z'));
  });
  it('loops only within the selected inclusive range', () => {
    expect(nextFrame(1, 1, 2)).toBe(2);
    expect(nextFrame(2, 1, 2)).toBe(1);
    expect(nextFrame(0, 1, 2)).toBe(1);
    expect(nextFrame(1, 1, 1)).toBe(1);
  });
  it('maps a time brush to the timesteps actually inside it', () => {
    expect(playbackRange(times, timeMillis(times[1]), timeMillis(times[2]))).toEqual([1, 2]);
    expect(playbackRange(times, timeMillis(times[0]) + 1, timeMillis(times[2]) - 1)).toEqual([1, 1]);
    expect(playbackRange(times, timeMillis(times[0]) + 1, timeMillis(times[1]) - 1)).toBeNull();
  });
  it('uses one scale for all frames, including empty frames', () => {
    const bar = animationColorbar([{maxs: [0]}, {maxs: [100]}, {maxs: [NaN]}], value => String(value));
    expect(bar.ticks.length).toBe(10);
    expect(bar.colors!.length).toBe(9);
    expect(bar.ticks[9]).toBeCloseTo(100);
    expect(bar.ticks.every((tick, index) => index === 0 || tick > bar.ticks[index - 1])).toBeTrue();
  });
});
