import { MapPlot } from 'src/app/core/models/map-plot';

export interface MapExportHeading { title: string; detail: string; }

function time(value: string | number | undefined): string {
  if (value === undefined || value === '') return '';
  const text = String(value);
  if (text.includes('UTC')) return text;
  return /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(text) ? text.replace('T', ' ').slice(0, 16) + ' UTC' : text;
}

/** Describe the displayed result, rather than unsaved edits in the analysis form. */
export function mapExportHeading(plots: MapPlot[], activeId?: number, animationTime?: string): MapExportHeading | undefined {
  const visible = plots.filter(plot => plot.visible);
  if (animationTime !== undefined) return {title:'Concentration animation',detail:animationTime};
  let plot = visible.find(plot => plot.agreementInfo) || visible.find(plot => plot.type === 'stats' && /^member \d+$/.test(plot.legendLayer))
    || visible.find(plot => plot.id === activeId) || visible.find(plot => plot.type === 'flexpart');
  if (!plot) return undefined;
  const memberOnly = plot.type === 'stats' && /^member \d+$/.test(plot.legendLayer);
  if (memberOnly) {
    const parent = plot.name.split(' - ')[0];
    plot = plots.find(candidate => candidate.agreementInfo && candidate.name.startsWith(parent + ' - ')) || plot;
  }
  const info = plot.agreementInfo;
  const threshold = info?.threshold !== undefined ? `Threshold ≥ ${info.threshold}${info.unit ? ' ' + info.unit : ''}` : '';
  const timestep = time(info?.startTime || plot.selectedParams?.['Ti']?.value);
  if (info?.analysis === 'duration') return {title:'Duration above threshold — median',detail:[threshold,'Full simulation'].filter(Boolean).join(' · ')};
  if (info?.analysis === 'arrival') return {title:'Arrival time — median',detail:[threshold,'Full simulation'].filter(Boolean).join(' · ')};
  if (info?.analysis === 'maximum') {
    const period = info.endTime ? `${time(info.startTime)} – ${time(info.endTime)}` : String(plot.selectedParams?.['Ti']?.value || '').replace(/^At any time: /,'');
    return {title:'Exceedance in a duration',detail:[threshold,period].filter(Boolean).join(' · ')};
  }
  if (info || plot.legendLayer === 'percentage agreement') {
    return {title:memberOnly ? 'Member exceedance at a timestep' : 'Exceedance at a timestep',detail:[threshold,timestep].filter(Boolean).join(' · ')};
  }
  const substance = plot.selectedParams?.['substance']?.value;
  const height = plot.selectedParams?.['height']?.value;
  return {title:substance ? `Concentration — ${substance}` : 'Concentration',detail:[timestep,height !== undefined ? `Height: ${height} m` : ''].filter(Boolean).join(' · ')};
}
