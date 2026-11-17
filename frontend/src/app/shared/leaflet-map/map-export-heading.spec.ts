import { mapExportHeading } from './map-export-heading';
import { MapPlot } from 'src/app/core/models/map-plot';

describe('Saved map headings', () => {
  const base: MapPlot=Object.assign(new MapPlot('flexpart'),{id:1,visible:true,type:'flexpart',legendLayer:'spec001_mr',name:'Plot 1',selectedParams:{Ti:{index:1,value:'2026-01-10T01:00:00'},height:{index:1,value:1}}});
  const stats=(analysis:'duration'|'arrival'|'maximum'|'timestep'): MapPlot=>Object.assign(new MapPlot('stats'),{...base,id:2,type:'stats',name:'Ensemble analysis 1 - percentage agreement',agreementInfo:{analysis,threshold:.5,unit:'ng/m³',memberCount:50,description:'',startTime:'2026-01-10T01:00:00Z',endTime:'2026-01-10T18:00:00Z'}});
  it('labels median duration and its plotted threshold over the full simulation',()=>{
    expect(mapExportHeading([stats('duration')],2)).toEqual({title:'Duration above threshold — median',detail:'Threshold ≥ 0.5 ng/m³ · Full simulation'});
  });
  it('labels arrival analysis with its threshold',()=>{
    expect(mapExportHeading([stats('arrival')],2)?.title).toBe('Arrival time — median');
    expect(mapExportHeading([stats('arrival')],2)?.detail).toContain('Threshold ≥ 0.5 ng/m³');
  });
  it('uses the plotted timestep rather than a changed form value',()=>{
    const plot=stats('timestep');plot.selectedParams={Ti:{index:9,value:'2026-01-10T09:00:00'}};
    expect(mapExportHeading([plot],2)?.detail).toBe('Threshold ≥ 0.5 ng/m³ · 2026-01-10 01:00 UTC');
  });
  it('includes both ends of a selected exceedance period',()=>{
    const heading=mapExportHeading([stats('maximum')],2)!;
    expect(heading.title).toBe('Exceedance in a duration');
    expect(heading.detail).toContain('2026-01-10 01:00 UTC – 2026-01-10 18:00 UTC');
  });
  it('includes time and height for a concentration plot',()=>{
    expect(mapExportHeading([base],1)).toEqual({title:'Concentration',detail:'2026-01-10 01:00 UTC · Height: 1 m'});
  });
  it('finds the threshold for visible member overlays even when concentration is active',()=>{
    const parent=Object.assign(new MapPlot('stats'),stats('timestep'),{visible:false});
    const member=Object.assign(new MapPlot('stats'),{...base,id:3,type:'stats',name:'Ensemble analysis 1 - member 1',legendLayer:'member 1'});
    expect(mapExportHeading([base,parent,member],1)?.title).toBe('Member exceedance at a timestep');
    expect(mapExportHeading([base,parent,member],1)?.detail).toContain('Threshold ≥ 0.5 ng/m³');
  });
  it('identifies the current animation timestep in saved snapshots',()=>{
    expect(mapExportHeading([stats('duration')],2,'2026-01-10 04:00 UTC')).toEqual({title:'Concentration animation',detail:'2026-01-10 04:00 UTC'});
  });
  it('does not invent a title when no result is displayed',()=>{
    expect(mapExportHeading([Object.assign(new MapPlot('flexpart'),base,{visible:false})],1)).toBeUndefined();
  });
});
