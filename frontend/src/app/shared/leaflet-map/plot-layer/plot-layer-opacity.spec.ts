import { BehaviorSubject } from 'rxjs';
import { PlotLayerComponent } from './plot-layer.component';
import { MapService } from 'src/app/core/services/map.service';
import { MapPlot } from 'src/app/core/models/map-plot';

describe('Shared result layer opacity', () => {
  let service: MapService;
  let active: BehaviorSubject<MapPlot>;
  let layer: any;
  let component: PlotLayerComponent;
  let plots: any;
  beforeEach(() => {
    service = new MapService();
    active = new BehaviorSubject({id:1} as MapPlot);
    layer = {setOpacity:jasmine.createSpy(),setZIndex:jasmine.createSpy(),setStyle:jasmine.createSpy(),on:()=>{}};
    plots = {addTiff:jasmine.createSpy().and.returnValue(layer),addTiffMask:()=>layer,flexpartPlotToLayer:()=>layer,setColors:()=>{}};
    component = new PlotLayerComponent(plots, {dispatch:()=>{}} as any, service);
    Object.defineProperty(component,'activePlot$',{value:active});
    component.mapPlot = {id:1,type:'flexpart',legendLayer:'spec001_mr',data:{},metadata:{}} as MapPlot;
  });
  afterEach(()=>component.ngOnDestroy());
  it('updates raster opacity and retains it across active plot changes', () => {
    component.ngOnInit();service.setOverlayOpacity(.35);active.next({id:2} as MapPlot);
    expect(layer.setOpacity).toHaveBeenCalledWith(.35);
    expect(layer.setOpacity.calls.mostRecent().args).toEqual([.35]);
    component.ngOnDestroy();layer.setOpacity.calls.reset();service.setOverlayOpacity(.9);
    expect(layer.setOpacity).not.toHaveBeenCalled();
  });
  it('applies the selected opacity to new layers, including arrival maps', () => {
    service.setOverlayOpacity(0);component.mapPlot.legendLayer='arrival time';component.mapPlot.type='stats';component.ngOnInit();
    expect(plots.addTiff.calls.mostRecent().args[2]).toBe(true);
    expect(layer.setOpacity.calls.mostRecent().args).toEqual([0]);
    service.setOverlayOpacity(1);expect(layer.setOpacity.calls.mostRecent().args).toEqual([1]);
  });
  it('applies opacity to member contours without changing their stacking order', () => {
    component.mapPlot.type='stats';component.mapPlot.legendLayer='member 1';component.ngOnInit();service.setOverlayOpacity(.4);
    expect(layer.setOpacity.calls.mostRecent().args).toEqual([.4]);expect(layer.setZIndex.calls.mostRecent().args).toEqual([1500]);
  });
  it('updates both vector fill and stroke opacity', () => {
    component.mapPlot.geojson={} as any;component.ngOnInit();service.setOverlayOpacity(.25);
    expect(layer.setStyle.calls.mostRecent().args).toEqual([{opacity:.25,fillOpacity:.25}]);
  });
  it('clamps values and ignores nonfinite input', () => {
    service.setOverlayOpacity(2);expect(service.overlayOpacity).toBe(1);
    service.setOverlayOpacity(-1);expect(service.overlayOpacity).toBe(0);
    service.setOverlayOpacity(NaN);expect(service.overlayOpacity).toBe(0);
  });
});
