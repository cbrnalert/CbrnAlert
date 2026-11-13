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
