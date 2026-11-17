import { MapPlot } from 'src/app/core/models/map-plot';

export const HISTOGRAM_BAR_FRACTION = 0.8;
const CONCENTRATION_BIN_COUNT = 18;

export interface MaximumHistogram {
  centers: number[]; widths: number[]; edges: number[]; colors: string[];
  threshold: number; unit: string; lower: number; median: number; upper: number; range: [number,number];
}
export interface ArrivalDistribution {
  maximum?: MaximumHistogram;
  key: string;
  inside: boolean;
  longitude?: number; latitude?: number;
  times: string[]; counts: number[];
  reached: number; valid: number; total: number; sampled: number;
  median?: string; lower?: string; upper?: string;
  message: string;
}

export function arrivalDistribution(plot: MapPlot, longitude: number, latitude: number): ArrivalDistribution {
  const grid = plot.data, info = plot.agreementInfo;
  const empty: ArrivalDistribution = {key: 'outside', inside: false, times: [], counts: [], reached: 0, valid: 0, total: info?.memberCount || 0, sampled: 0, message: 'Outside model domain'};
  if (!grid || !info) return empty;
  const column = Math.floor((longitude-grid.xmin)/grid.pixelWidth), row = Math.floor((grid.ymax-latitude)/grid.pixelHeight);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return empty;
  const times = info.arrivalTimes || [];
  const bins = info.arrivalHistogram?.[row]?.[column];
  const counts = times.map(() => 0);
  for (const [index, count] of bins || []) if (index >= 0 && index < times.length) counts[index] = count;
  const reached = info.counts?.[row]?.[column] || 0, valid = info.validCounts?.[row]?.[column] || 0;
  const sampled = info.arrivalCounts?.[row]?.[column] || 0;
  const date = (hours: number | null | undefined) => hours == null || hours < 0 || !info.startTime ? undefined : new Date(Date.parse(info.startTime) + hours*3600000).toISOString();
  return {key: `${plot.id}:${row}:${column}`, inside: true, longitude: grid.xmin+(column+.5)*grid.pixelWidth,
    latitude: grid.ymax-(row+.5)*grid.pixelHeight, times, counts, reached, valid, total: info.memberCount, sampled,
    median: date(grid.values[0][row][column]), lower: date(info.arrivalLower?.[row]?.[column]), upper: date(info.arrivalUpper?.[row]?.[column]),
    message: !bins || !times.length ? 'Restart the backend and recalculate to load distributions.' :
      valid === 0 ? 'No valid member data' : !reached ? 'No exceedance during simulation' : !sampled ? 'First arrival unknown: earlier outputs missing' :
      sampled < reached ? `Arrival times known for ${sampled} of ${reached} reaching members` : ''};
}

/** Use the same saved-output time span at every location so bar widths remain comparable. */
export function arrivalHistogramWindow(times: string[]): {range: [number,number]; ticks: string[]} {
  const milliseconds = times.map(Date.parse);
  const first = 0, last = times.length - 1;
  const before = first > 0 ? milliseconds[first]-milliseconds[first-1] : (milliseconds[1]-milliseconds[0] || 3600000);
  const after = last+1<times.length ? milliseconds[last+1]-milliseconds[last] : (milliseconds[last]-milliseconds[last-1] || 3600000);
  const interval = 6 * 3600000;
  const ticks: string[] = [];
  for (let time=Math.ceil(milliseconds[first]/interval)*interval;time<=milliseconds[last];time+=interval) {
    ticks.push(new Date(time).toISOString());
  }
  if (!ticks.length) ticks.push(times[first]);
  return {range:[milliseconds[first]-.75*before,milliseconds[last]+.75*after],ticks};
}

/** One exact maximum per complete member, decoded from cached [maximum, frequency] pairs. */
export function maximumDistribution(plot: MapPlot, longitude: number, latitude: number): ArrivalDistribution {
  const grid=plot.data, info=plot.agreementInfo;
  const empty: ArrivalDistribution={key:'outside',inside:false,times:[],counts:[],reached:0,valid:0,total:info?.memberCount||0,sampled:0,message:'Outside model domain'};
  if (!grid||!info) return empty;
  const column=Math.floor((longitude-grid.xmin)/grid.pixelWidth),row=Math.floor((grid.ymax-latitude)/grid.pixelHeight);
  if (column<0||row<0||column>=grid.width||row>=grid.height) return empty;
  const snapshot=info.analysis === 'timestep';
  const pairs=snapshot?info.concentrationValues?.[row]?.[column]:info.maximumValues?.[row]?.[column];
  const values:number[]=[];
  for (const [value,count] of pairs||[]) if (Number.isFinite(value)&&Number.isInteger(count)&&count>0&&count<=info.memberCount) {
    for (let i=0;i<count;i++) values.push(value);
  }
  values.sort((a,b)=>a-b);
  const result:ArrivalDistribution={...empty,key:`${plot.id}:${row}:${column}`,inside:true,
    longitude:grid.xmin+(column+.5)*grid.pixelWidth,latitude:grid.ymax-(row+.5)*grid.pixelHeight,
    reached:info.counts?.[row]?.[column]||0,valid:info.validCounts?.[row]?.[column]||0,sampled:values.length,
    message:!pairs?'Restart the backend and recalculate to load distributions.':!values.length?(snapshot?'No valid member data at this timestep':'No complete member data for this duration'):values.length<info.memberCount?`${snapshot?'Concentrations':'Maxima'} available for ${values.length}/${info.memberCount} members`:''};
  if (!values.length) return result;
  const threshold=info.threshold!;
  const minimum=Math.min(0,values[0]);
  const maximum=Math.max(values[values.length-1],threshold,Number.EPSILON);
  const high=maximum+(maximum-minimum)*.05;
  const binWidth=(high-minimum)/CONCENTRATION_BIN_COUNT;
  // Anchor a uniform bin grid at the threshold instead of splitting one bin into two.
  const firstEdge=Math.floor((minimum-threshold)/binWidth);
  const lastEdge=Math.ceil((high-threshold)/binWidth);
  const edges=Array.from({length:lastEdge-firstEdge+1},(_,i)=>threshold+(firstEdge+i)*binWidth);
  const counts=edges.slice(1).map(()=>0);
  for (const value of values) {
    const index=Math.floor((value-threshold)/binWidth)-firstEdge;
    if (index>=0&&index<counts.length) counts[index]++;
  }
  const quantile=(p:number)=>{const index=(values.length-1)*p,low=Math.floor(index),fraction=index-low;return values[low]+fraction*(values[Math.ceil(index)]-values[low]);};
  result.counts=counts;
  result.maximum={edges,centers:counts.map((_,i)=>(edges[i]+edges[i+1])/2),widths:counts.map(()=>binWidth*HISTOGRAM_BAR_FRACTION),
    colors:counts.map((_,i)=>edges[i]>=threshold?'#5b8db8':'#aeb4bc'),threshold,unit:info.unit||'',
    lower:quantile(.1),median:quantile(.5),upper:quantile(.9),range:[edges[0],edges[edges.length-1]]};
  return result;
}
