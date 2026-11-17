import { MapPlot } from 'src/app/core/models/map-plot';

/** Read the already calculated grid locally; cursor movement never requests the backend. */
export function agreementReadout(plot: MapPlot, longitude: number, latitude: number): string {
  const grid = plot.data;
  if (!grid) return '';
  const column = Math.floor((longitude - grid.xmin) / grid.pixelWidth);
  const row = Math.floor((grid.ymax - latitude) / grid.pixelHeight);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return 'Outside model domain';
  const value = grid.values[0][row][column];
  const info = plot.agreementInfo;
  const denominator = info?.validCounts?.[row]?.[column] ?? info?.memberCount;
  if (info?.analysis === 'arrival') {
    if (denominator === 0) return 'No valid member data';
    const reached = info.counts?.[row]?.[column] || 0;
    const total = ` · ${reached}/${denominator} members reached` + (denominator !== info.memberCount ? ` (${info.memberCount} total)` : '');
    if (!reached) return 'No exceedance during simulation' + total;
    const sampleCount = info.arrivalCounts?.[row]?.[column] || 0;
    if (value === null || !Number.isFinite(value) || value < 0 || !sampleCount) return 'Arrival unknown: earlier outputs missing' + total;
    const label = (hours: number | null | undefined) => hours == null || !info.startTime ? 'unknown' : new Date(Date.parse(info.startTime) + hours * 3600000).toISOString().slice(0,16).replace('T',' ') + ' UTC';
    const offset = (hours: number | null | undefined) => {
      if (hours == null) return 'unknown';
      const difference = hours - value;
      const magnitude = Number(Math.abs(difference).toFixed(1));
      return magnitude === 0 ? '0' : `${difference < 0 ? '−' : '+'}${magnitude}`;
    };
    return `Median arrival: ${label(value)}\nP10–P90: ${offset(info.arrivalLower?.[row]?.[column])} / ${offset(info.arrivalUpper?.[row]?.[column])} h` + total +
      (sampleCount < reached ? ` · Arrival based on ${sampleCount} ${sampleCount === 1 ? 'member' : 'members'}` : '');
  }
  if (value === null || !Number.isFinite(value) || value < 0 || denominator === 0) return 'No valid member data';
  const count = info?.counts?.[row]?.[column] ?? (denominator === undefined ? undefined : Math.round(value * denominator / 100));
  const members = count === undefined ? '' : ` · ${count}/${denominator} members`;
  const incomplete = denominator !== undefined && info && denominator < info.memberCount ? ` (${info.memberCount} total)` : '';
  return `Agreement: ${Number(value.toFixed(1))}%${members}${incomplete}`;
}
