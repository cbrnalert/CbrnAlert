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
  if (value === null || !Number.isFinite(value) || value < 0 || denominator === 0) return 'No valid member data';
  const count = info?.counts?.[row]?.[column] ?? (denominator === undefined ? undefined : Math.round(value * denominator / 100));
  const members = count === undefined ? '' : ` · ${count}/${denominator} members`;
  const incomplete = denominator !== undefined && info && denominator < info.memberCount ? ` (${info.memberCount} total)` : '';
  return `Agreement: ${Number(value.toFixed(1))}%${members}${incomplete}`;
}
