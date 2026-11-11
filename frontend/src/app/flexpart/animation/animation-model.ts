import { ColorbarData } from 'src/app/core/api/models';

export interface AnimationSeries {
  times: string[];
  latitude: number;
  longitude: number;
  unit: string;
  ensemble: boolean;
  memberCount?: number;
  mean?: (number | null)[];
  median?: (number | null)[];
  lower?: (number | null)[];
  upper?: (number | null)[];
  concentration?: (number | null)[];
}

export function timeMillis(value: string): number {
  return Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

export function playbackRange(times: string[], start: number, end: number): [number, number] | null {
  const first = times.findIndex(time => timeMillis(time) >= start);
  let last = times.length - 1;
  while (last >= 0 && timeMillis(times[last]) > end) last--;
  return first < 0 || last < first ? null : [first, last];
}

export function nextFrame(current: number, start: number, end: number): number {
  return current < start || current >= end ? start : current + 1;
}

export function animationColorbar(rasters: any[], color: (value: number) => string): ColorbarData {
  const minimum = 0.001;
  const maximum = rasters.reduce((max, raster) => {
    const value = Number(raster.maxs?.[0]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, minimum * 10);
  const ticks = Array.from({length: 10}, (_, index) => minimum * Math.pow(maximum / minimum, index / 9));
  return {ticks, colors: ticks.slice(1).map((_, index) => color(1 - index / 8))};
}
