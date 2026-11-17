import type {} from '@geoman-io/leaflet-geoman-free';
import { MapPlotAction, MapPlotState } from './map-plot.state';
import { MapPlot } from '../models/map-plot';

describe('FLEXPART timestep replacement', () => {
  function setup(type: 'flexpart' | 'atp45' = 'flexpart') {
    const previous = new MapPlot('flexpart'), stats = new MapPlot('stats'), other = new MapPlot('atp45');
    const next = new MapPlot(type);
    let state: any = {mapPlots:[other,previous,stats],activePlot:previous};
    const context: any = {getState:()=>state,setState:(update:any)=>state=typeof update==='function'?update(state):update,
      dispatch:jasmine.createSpy('dispatch')};
    const service: any = {createMapPlotGeoJSON:()=>next,createMapPlotTiff:async()=>next};
    return {handler:new MapPlotState(service),context,next,other,previous,stats,getState:()=>state};
  }
  it('replaces prior timestep maps and statistics when adding GeoJSON results', () => {
    const test=setup();test.handler.add(test.context,{} as MapPlotAction.Add);
    expect(test.getState().mapPlots.map((plot:MapPlot)=>plot.id)).toEqual([test.other.id,test.next.id]);
    expect(test.context.dispatch.calls.mostRecent().args[0].mapPlotId).toBe(test.next.id);
  });
  it('replaces prior timestep maps and statistics after TIFF loading succeeds', async () => {
    const test=setup();await test.handler.addTiff(test.context,{} as MapPlotAction.AddTiff);
    expect(test.getState().mapPlots.map((plot:MapPlot)=>plot.id)).toEqual([test.other.id,test.next.id]);
  });
  it('preserves existing results when adding an unrelated ATP45 plot', () => {
    const test=setup('atp45');test.handler.add(test.context,{} as MapPlotAction.Add);
    expect(test.getState().mapPlots.length).toBe(4);
  });
});
