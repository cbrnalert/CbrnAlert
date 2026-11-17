import { arrivalDistribution, arrivalHistogramWindow, maximumDistribution } from './arrival-distribution';
import { MapPlot } from 'src/app/core/models/map-plot';
describe('Cached arrival distribution', () => {
  const plot = {id:7,data:{xmin:0,ymax:2,pixelWidth:1,pixelHeight:1,width:2,height:2,values:[[[1,-9999],[-9999,-9999]]]},
    agreementInfo:{analysis:'arrival',startTime:'2026-01-10T01:00:00Z',description:'',memberCount:4,
      counts:[[3,0],[0,1]],validCounts:[[4,4],[0,3]],arrivalCounts:[[3,0],[0,0]],
      arrivalLower:[[.2,null],[null,null]],arrivalUpper:[[1.8,null],[null,null]],
      arrivalTimes:['2026-01-10T01:00:00Z','2026-01-10T02:00:00Z','2026-01-10T03:00:00Z'],
      arrivalHistogram:[[[[0,1],[2,2]],[]],[[],[]]]}} as MapPlot;
  it('expands sparse output bins without changing counts or interpolating bars', () => {
    const d=arrivalDistribution(plot,.5,1.5);
    expect(d.counts).toEqual([1,0,2]);expect(d.sampled).toBe(3);expect(d.reached).toBe(3);
    expect(d.median).toBe('2026-01-10T02:00:00.000Z');expect(d.lower).toBe('2026-01-10T01:12:00.000Z');
    expect(d.longitude).toBe(.5);expect(d.latitude).toBe(1.5);expect(d.key).toBe('7:0:0');
  });
  it('separates no exceedance, no data and unknown arrival', () => {
    expect(arrivalDistribution(plot,1.5,1.5).message).toBe('No exceedance during simulation');
    expect(arrivalDistribution(plot,.5,.5).message).toBe('No valid member data');
    expect(arrivalDistribution(plot,1.5,.5).message).toContain('First arrival unknown');
  });
  it('identifies outside points and reuses a stable grid-cell key', () => {
    expect(arrivalDistribution(plot,-.1,1).inside).toBeFalse();
    expect(arrivalDistribution(plot,2,1).message).toBe('Outside model domain');
    expect(arrivalDistribution(plot,.1,1.9).key).toBe(arrivalDistribution(plot,.9,1.1).key);
  });
});

describe('Arrival histogram fixed time window', () => {
  const times=Array.from({length:18},(_,i)=>new Date(Date.UTC(2026,0,10,i+1)).toISOString());
  it('includes the full simulation and padding for the first and final bars', () => {
    const window=arrivalHistogramWindow(times);
    expect(window.range[0]).toBe(Date.parse(times[0])-.75*3600000);
    expect(window.range[1]).toBe(Date.parse(times[17])+.75*3600000);
    expect(window.range[1]-window.range[0]).toBe(18.5*3600000);
  });
  it('labels only six-hour UTC intervals', () => {
    const window=arrivalHistogramWindow(times);
    expect(window.ticks).toEqual([times[5],times[11],times[17]]);
    expect(window.ticks.map(time=>new Date(time).getUTCHours())).toEqual([6,12,18]);
  });
  it('supports a single saved output without invalid bounds', () => {
    const single=arrivalHistogramWindow([times[0]]);
    expect(single.range.every(Number.isFinite)).toBeTrue();
    expect(single.ticks).toEqual([times[0]]);
  });
});

describe('Member maximum concentration distribution', () => {
  const plot={id:8,data:{xmin:0,ymax:2,pixelWidth:1,pixelHeight:1,width:2,height:2,values:[[[50,0],[-9999,0]]]},
    agreementInfo:{analysis:'maximum',threshold:5,unit:'ng/m³',memberCount:3,description:'',counts:[[2,0],[1,0]],validCounts:[[3,3],[2,3]],
      maximumValues:[[[[0,1],[5,1],[10,1]],[[0,3]]],[[],[[0,1]]]]}} as MapPlot;
  it('uses exact complete-member maxima for percentiles and counts each member once', () => {
    const d=maximumDistribution(plot,.5,1.5),peak=d.maximum!;
    expect(d.counts.reduce((a,b)=>a+b,0)).toBe(3);expect(d.sampled).toBe(3);
    expect(peak.median).toBe(5);expect(peak.lower).toBe(1);expect(peak.upper).toBe(9);
    expect(peak.edges).toContain(5);
    expect(d.counts.reduce((sum,count,i)=>sum+(peak.colors[i]==='#5b8db8'?count:0),0)).toBe(2);
    expect(d.counts.reduce((sum,count,i)=>sum+(peak.colors[i]==='#aeb4bc'?count:0),0)).toBe(1);
  });
  it('uses equal concentration widths without splitting the threshold bin', () => {
    const d=maximumDistribution(plot,.5,1.5),peak=d.maximum!;
    expect(new Set(peak.widths).size).toBe(1);
    const width=peak.edges[1]-peak.edges[0];
    for (let i=1;i<peak.edges.length;i++) expect(peak.edges[i]-peak.edges[i-1]).toBeCloseTo(width,10);
    expect(peak.edges).toContain(5);
    expect(d.counts.reduce((sum,count)=>sum+count,0)).toBe(3);
  });
  it('retains zero and exact-threshold samples with fractional concentrations', () => {
    for (const threshold of [.1,.2,.3,.9]) {
      const fractional={...plot,agreementInfo:{...plot.agreementInfo,threshold,maximumValues:[[[[0,1],[threshold,1],[threshold*3,1]]]]}} as MapPlot;
      const d=maximumDistribution(fractional,.5,1.5),peak=d.maximum!;
      expect(d.counts.reduce((sum,count)=>sum+count,0)).toBe(3);
      expect(d.counts.reduce((sum,count,i)=>sum+(peak.colors[i]==='#5b8db8'?count:0),0)).toBe(2);
      expect(new Set(peak.widths).size).toBe(1);
    }
  });
  it('retains zero concentrations and draws zero percentile markers', () => {
    const d=maximumDistribution(plot,1.5,1.5);
    expect(d.counts.reduce((a,b)=>a+b,0)).toBe(3);expect(d.maximum!.median).toBe(0);expect(d.maximum!.lower).toBe(0);expect(d.maximum!.upper).toBe(0);
    expect(d.maximum!.range[1]).toBeGreaterThan(5);
  });
  it('distinguishes missing maximum data, incomplete histories and outside points', () => {
    expect(maximumDistribution(plot,.5,.5).maximum).toBeUndefined();
    expect(maximumDistribution(plot,.5,.5).message).toContain('No complete member data');
    expect(maximumDistribution(plot,1.5,.5).message).toBe('Maxima available for 1/3 members');
    expect(maximumDistribution(plot,-1,1).inside).toBeFalse();
  });
});

describe('Single-timestep concentration distribution', () => {
  const plot={id:12,data:{xmin:0,ymax:1,pixelWidth:1,pixelHeight:1,width:2,height:1,values:[[[50,-9999]]]},
    agreementInfo:{analysis:'timestep',threshold:5,unit:'ng/m³',memberCount:3,description:'',counts:[[2,0]],validCounts:[[3,0]],
      concentrationValues:[[[[0,1],[5,1],[10,1]],[]]],maximumValues:[[[[99,3]],[]]]}} as MapPlot;
  it('uses selected-time concentrations and the same equal-width bins and markers', () => {
    const d=maximumDistribution(plot,.5,.5);
    expect(d.maximum!.median).toBe(5);expect(d.maximum!.lower).toBe(1);expect(d.maximum!.upper).toBe(9);
    expect(d.maximum!.threshold).toBe(5);expect(d.counts.reduce((a,b)=>a+b,0)).toBe(3);
    expect(new Set(d.maximum!.widths).size).toBe(1);
    expect(d.counts.reduce((sum,n,i)=>sum+(d.maximum!.colors[i]==='#5b8db8'?n:0),0)).toBe(2);
  });
  it('reports unavailable snapshot data without describing it as a duration maximum', () => {
    expect(maximumDistribution(plot,1.5,.5).message).toBe('No valid member data at this timestep');
  });
});
