import { agreementReadout } from './agreement-readout';
import { MapPlot } from 'src/app/core/models/map-plot';
describe('Agreement map cursor values', () => {
  const plot = {data: {xmin: 0, ymax: 2, pixelWidth: 1, pixelHeight: 1, width: 2, height: 2,
    values: [[[-9999, 0], [50, 100]]]}, agreementInfo: {memberCount: 3, description: '', counts: [[0,0],[1,3]], validCounts: [[0,3],[2,3]]}} as MapPlot;
  it('shows exact counts, valid denominator, and zero agreement', () => {
    expect(agreementReadout(plot,.5,.5)).toBe('Agreement: 50% · 1/2 members (3 total)');
    expect(agreementReadout(plot,1.5,1.5)).toBe('Agreement: 0% · 0/3 members');
    expect(agreementReadout(plot,1.5,.5)).toBe('Agreement: 100% · 3/3 members');
  });
  it('distinguishes no data and outside the grid, including its edges', () => {
    expect(agreementReadout(plot,.5,1.5)).toBe('No valid member data');
    expect(agreementReadout(plot,-.1,.5)).toBe('Outside model domain');
    expect(agreementReadout(plot,2,.5)).toBe('Outside model domain');
  });
});

describe('Arrival time map cursor values', () => {
  const plot = {data: {xmin:0,ymax:2,pixelWidth:1,pixelHeight:1,width:2,height:2,values:[[[0,-9999],[-9999,1]]]},
    agreementInfo: {analysis:'arrival', startTime:'2026-01-10T01:00:00Z', memberCount:3, description:'',
      counts:[[1,0],[1,2]],validCounts:[[3,3],[2,3]],arrivalCounts:[[1,0],[0,1]],
      arrivalLower:[[0,null],[null,.5]],arrivalUpper:[[0,null],[null,1.5]]}} as MapPlot;
  it('shows UTC median and relative percentile offsets in hours', () => {
    expect(agreementReadout(plot,.5,1.5)).toContain('Median arrival: 2026-01-10 01:00 UTC');
    expect(agreementReadout(plot,.5,1.5)).toContain('P10–P90: 0 / 0 h');
    expect(agreementReadout(plot,1.5,.5)).toContain('P10–P90: −0.5 / +0.5 h');
    expect(agreementReadout(plot,1.5,.5)).toContain('2/3 members reached · Arrival based on 1 member');
  });
  it('separates no exceedance and unknown first arrival', () => {
    expect(agreementReadout(plot,1.5,1.5)).toContain('No exceedance during simulation');
    expect(agreementReadout(plot,.5,.5)).toContain('Arrival unknown: earlier outputs missing');
    expect(agreementReadout(plot,.5,.5)).toContain('1/2 members reached (3 total)');
  });
});
