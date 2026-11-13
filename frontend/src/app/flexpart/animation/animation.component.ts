import { AfterViewInit, ChangeDetectorRef, Component, EmbeddedViewRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, TemplateRef, ViewChild, ViewContainerRef } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Store } from '@ngxs/store';
import { DomEvent, LeafletMouseEvent, Marker, marker, TileLayer } from 'leaflet';
import type {} from '@geoman-io/leaflet-geoman-free';
import { from, Subscription, mergeMap, map, timeout } from 'rxjs';
import parseGeoraster from 'georaster';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { FlexpartService } from '../flexpart.service';
import { MapService } from 'src/app/core/services/map.service';
import { MapPlotsService } from 'src/app/core/services/map-plots.service';
import { MapPlotAction, MapPlotState } from 'src/app/core/state/map-plot.state';
import { ColorbarData } from 'src/app/core/api/models';
import { AnimationSeries, animationColorbar, nextFrame, playbackRange, timeMillis } from './animation-model';

@Component({
  selector: 'app-flexpart-animation',
  templateUrl: './animation.component.html',
  styleUrls: ['./animation.component.scss']
})
export class AnimationComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() outputId: string;
  @Input() layer: string;
  @Input() dimensions: {[key: string]: string | number};
  @Input() timesteps: (string | number)[];
  @Output() closed = new EventEmitter<void>();
  @ViewChild('animationDock') template: TemplateRef<unknown>;

  times: string[] = [];
  currentIndex = 0;
  startIndex = 0;
  endIndex = 0;
  loadedFrames = 0;
  ready = false;
  playing = false;
  frameLoading = false;
  frameDuration = 1000;
  error = '';
  seriesError = '';
  seriesLoading = false;
  picking = false;
  series?: AnimationSeries;
  colorbar?: ColorbarData;
  coordinates = new FormGroup({
    latitude: new FormControl<number | null>(null, [Validators.required, Validators.min(-90), Validators.max(90)]),
    longitude: new FormControl<number | null>(null, [Validators.required, Validators.min(-180), Validators.max(180)])
  });

  readonly resizeEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  private resizeState?: {edge: string; pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number};
  private dock?: HTMLElement;
  private legend?: HTMLElement;
  private view?: EmbeddedViewRef<unknown>;
  private chart?: HTMLElement;
  private plotly?: typeof import('plotly.js');
  private plotlyLoading?: Promise<typeof import('plotly.js')>;
  private chartInitialized = false;
  private chartTask: Promise<void> = Promise.resolve();
  private suppressRangeEvent = false;
  private observer?: ResizeObserver;
  private frameRequest?: Subscription;
  private seriesRequest?: Subscription;
  private coordinateChanges = this.coordinates.valueChanges.subscribe(() => {
    this.seriesRequest?.unsubscribe();
    this.seriesLoading = false;
    this.series = undefined;
    this.seriesError = '';
    this.updateChart();
  });
  private rasters: any[] = [];
  private currentLayer?: TileLayer;
  private pendingLayer?: TileLayer;
  private pendingIndex?: number;
  private locationMarker?: Marker;
  private timer?: ReturnType<typeof setTimeout>;
  private loadTimer?: ReturnType<typeof setTimeout>;
  private frameToken = 0;
  private seriesToken = 0;
  private destroyed = false;
  private hiddenPlotIds: number[] = [];
  private plotsHidden = false;
  private initialMapView?: {center: import('leaflet').LatLng; zoom: number};

  constructor(
    private flexpart: FlexpartService,
    public mapService: MapService,
    private plots: MapPlotsService,
    private store: Store,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private container: ViewContainerRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.dock && Object.values(changes).some(change => !change.firstChange)) {
      queueMicrotask(() => { if (!this.destroyed) this.zone.run(() => this.closed.emit()); });
    }
  }

  ngAfterViewInit(): void {
    const map = this.mapService.leafletMap;
    if (!map) { this.closed.emit(); return; }
    this.times = [...new Set((this.timesteps || []).map(String))].sort((a, b) => timeMillis(a) - timeMillis(b));
    this.endIndex = this.times.length - 1;
    this.hiddenPlotIds = this.store.selectSnapshot(MapPlotState.mapPlots).filter(plot => plot.visible && (plot.type === 'flexpart' || plot.type === 'stats')).map(plot => plot.id);
    this.initialMapView = {center: map.getCenter(), zoom: map.getZoom()};
    const mapElement = map.getContainer();
    this.dock = document.createElement('div');
    this.dock.className = 'flexpart-animation-dock';
    mapElement.appendChild(this.dock);
    this.view = this.container.createEmbeddedView(this.template);
    this.view.rootNodes.forEach(node => this.dock!.appendChild(node));
    this.view.detectChanges();
    this.chart = this.dock.querySelector('.animation-chart') as HTMLElement;
    this.legend = this.dock.querySelector('.animation-colorbar') as HTMLElement;
    mapElement.appendChild(this.legend);
    DomEvent.disableClickPropagation(this.dock);
    DomEvent.disableScrollPropagation(this.dock);
    mapElement.classList.add('animation-active');
    this.mapService.animationActive = true;
    map.closePopup();
    const pane = map.getPane('flexpart-animation') || map.createPane('flexpart-animation');
    pane.style.zIndex = '450';
    this.observer = new ResizeObserver(() => {
      if (this.destroyed || !this.dock) return;
      if (this.plotly && this.chartInitialized && this.chart) void this.plotly.Plots.resize(this.chart);
    });
    this.observer.observe(this.dock);
    this.updateChart();
    this.loadFrames();
  }

  startResize(event: PointerEvent, edge: string): void {
    if (event.button !== 0 || !this.dock) return;
    event.preventDefault();
    event.stopPropagation();
    this.stopResize();
    const bounds = this.dock.getBoundingClientRect();
    const mapBounds = this.mapService.leafletMap.getContainer().getBoundingClientRect();
    const left = bounds.left - mapBounds.left, top = bounds.top - mapBounds.top;
    Object.assign(this.dock.style, {left: `${left}px`, top: `${top}px`, bottom: 'auto', transform: 'none', width: `${bounds.width}px`, height: `${bounds.height}px`});
    this.resizeState = {edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left, top, width: bounds.width, height: bounds.height};
    document.addEventListener('pointermove', this.resizePanel);
    document.addEventListener('pointerup', this.stopResize);
    document.addEventListener('pointercancel', this.stopResize);
    window.addEventListener('blur', this.stopResize);
  }

  private resizePanel = (event: PointerEvent) => {
    const state = this.resizeState;
    if (!state || !this.dock || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const map = this.mapService.leafletMap.getContainer();
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    const minWidth = Math.min(480, map.clientWidth - 16), minHeight = Math.min(260, map.clientHeight - 16);
    let left = state.left, top = state.top, right = left + state.width, bottom = top + state.height;
    if (state.edge.includes('w')) left = Math.max(8, Math.min(state.left + dx, right - minWidth));
    if (state.edge.includes('e')) right = Math.min(map.clientWidth - 8, Math.max(right + dx, left + minWidth));
    if (state.edge.includes('n')) top = Math.max(8, Math.min(state.top + dy, bottom - minHeight));
    if (state.edge.includes('s')) bottom = Math.min(map.clientHeight - 8, Math.max(bottom + dy, top + minHeight));
    Object.assign(this.dock.style, {left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`});
  };

  private stopResize = () => {
    this.resizeState = undefined;
    document.removeEventListener('pointermove', this.resizePanel);
    document.removeEventListener('pointerup', this.stopResize);
    document.removeEventListener('pointercancel', this.stopResize);
    window.removeEventListener('blur', this.stopResize);
  };

  get currentTime(): string { return this.label(this.currentIndex); }
  get rangeStart(): string { return this.label(this.startIndex); }
  get rangeEnd(): string { return this.label(this.endIndex); }
  get unit(): string { return /spec\d+_mr/.test(this.layer) ? 'ng/m³' : /D_spec/.test(this.layer) ? 'ng/m²' : ''; }
  private iso(index: number): string { return new Date(timeMillis(this.times[index])).toISOString(); }
  private label(index: number): string {
    return this.times[index] ? this.iso(index).replace('T', ' ').slice(0, 16) + ' UTC' : '';
  }

  private loadFrames(): void {
    if (!this.times.length || this.times.some(time => !Number.isFinite(timeMillis(time)))) {
      this.error = 'No valid output times are available for animation.';
      return;
    }
    const dimensions = {...this.dimensions};
    if ('height' in dimensions) dimensions['height'] = Number(dimensions['height']);
    this.rasters = new Array(this.times.length);
    this.frameRequest = from(this.times.map((time, index) => ({time, index}))).pipe(
      mergeMap(({time, index}) => this.flexpart.getAnimationFrame(this.outputId, this.layer, {...dimensions, Ti: time}).pipe(
        timeout(90000),
        mergeMap(blob => from(blob.arrayBuffer()).pipe(mergeMap(buffer => from(parseGeoraster(buffer))))),
        map(raster => ({raster, index}))
      ), 2)
    ).subscribe({
      next: ({raster, index}) => {
        this.rasters[index] = raster;
        this.loadedFrames++;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load the animation frames. Close the animation and try again.';
        this.cdr.markForCheck();
      },
      complete: () => {
        if (this.destroyed) return;
        const scale = this.plots._colorScaleConc();
        this.colorbar = animationColorbar(this.rasters, value => scale(value).hex());
        const first = this.rasters[0];
        this.mapService.leafletMap.fitBounds([[first.ymin, first.xmin], [first.ymax, first.xmax]], {
          paddingTopLeft: [16, 16], paddingBottomRight: [110, (this.dock?.offsetHeight || 320) + 24], maxZoom: 12
        });
        this.ready = true;
        this.playing = true;
        this.showFrame(this.startIndex);
        this.cdr.markForCheck();
      }
    });
  }

  private scheduleNext(): void {
    clearTimeout(this.timer);
    if (this.playing && this.ready && !this.frameLoading && !this.destroyed) {
      this.timer = setTimeout(() => this.zone.run(() => this.showFrame(nextFrame(this.currentIndex, this.startIndex, this.endIndex))), this.frameDuration);
    }
  }

  private showFrame(index: number): void {
    if (!this.ready || !this.colorbar || this.destroyed) return;
    clearTimeout(this.timer);
    clearTimeout(this.loadTimer);
    const token = ++this.frameToken;
    this.pendingLayer?.remove();
    this.frameLoading = true;
    const layer = this.plots.addTiff(this.rasters[index], this.colorbar) as unknown as TileLayer;
    layer.options.pane = 'flexpart-animation';
    layer.setOpacity(0);
    this.pendingLayer = layer;
    this.pendingIndex = index;
    layer.once('load', () => this.zone.run(() => {
      if (this.destroyed || token !== this.frameToken) { layer.remove(); return; }
      clearTimeout(this.loadTimer);
      if (!this.plotsHidden) {
        const actions = this.hiddenPlotIds.map(id => new MapPlotAction.Hide(id));
        if (actions.length) this.store.dispatch(actions);
        this.plotsHidden = true;
      }
      this.currentLayer?.remove();
      this.currentLayer = layer;
      this.pendingLayer = undefined;
      this.pendingIndex = undefined;
      layer.setOpacity(0.8);
      this.currentIndex = index;
      this.frameLoading = false;
      this.moveCursor();
      this.scheduleNext();
      this.cdr.markForCheck();
    }));
    this.loadTimer = setTimeout(() => this.zone.run(() => {
      if (token !== this.frameToken || this.destroyed) return;
      layer.remove();
      this.pendingLayer = undefined;
      this.pendingIndex = undefined;
      this.frameLoading = false;
      this.playing = false;
      this.error = 'The map frame did not finish rendering. Try playback again.';
      this.cdr.markForCheck();
    }), 15000);
    layer.addTo(this.mapService.leafletMap);
    this.cdr.markForCheck();
  }

  togglePlay(): void {
    this.playing = !this.playing;
    if (this.playing) {
      this.error = '';
      if (!this.currentLayer) this.showFrame(this.startIndex);
      else this.scheduleNext();
    } else clearTimeout(this.timer);
  }

  step(direction: number): void {
    this.playing = false;
    clearTimeout(this.timer);
    const index = direction > 0 ? nextFrame(this.currentIndex, this.startIndex, this.endIndex) : (this.currentIndex <= this.startIndex ? this.endIndex : this.currentIndex - 1);
    this.showFrame(index);
  }

  changeSpeed(value: string): void {
    this.frameDuration = Number(value);
    this.scheduleNext();
  }

  applyRange(start: number, end: number): void {
    this.startIndex = Math.max(0, Math.min(start, this.times.length - 1));
    this.endIndex = Math.max(this.startIndex, Math.min(end, this.times.length - 1));
    clearTimeout(this.timer);
    if (this.currentIndex < this.startIndex || this.currentIndex > this.endIndex || (this.pendingIndex !== undefined && (this.pendingIndex < this.startIndex || this.pendingIndex > this.endIndex))) this.showFrame(this.startIndex);
    else this.scheduleNext();
    this.cdr.markForCheck();
  }

  fullRange(): void {
    this.applyRange(0, this.times.length - 1);
    if (this.chartInitialized && this.plotly && this.chart) void this.plotly.relayout(this.chart, {'xaxis.range': this.axisRange()});
  }

  private axisRange(): [number, number] {
    const first = timeMillis(this.times[this.startIndex]), last = timeMillis(this.times[this.endIndex]);
    return first === last ? [first - 1800000, last + 1800000] : [first, last];
  }

  private cursor(): Partial<import('plotly.js').Shape> {
    const time = this.times.length ? this.iso(this.currentIndex) : '';
    return {type: 'line', xref: 'x', yref: 'paper', x0: time, x1: time, y0: 0, y1: 1, line: {color: 'red', width: 2}};
  }

  private moveCursor(): void {
    if (this.chartInitialized && this.plotly && this.chart) {
      void this.plotly.relayout(this.chart, {shapes: [this.cursor()]}).catch(() => {});
    }
  }

  private onRangeChanged = (event: Record<string, unknown>) => {
    if (this.suppressRangeEvent || !this.times.length) return;
    let bounds = event['xaxis.range'] as (string | number)[] | undefined;
    if (!bounds && event['xaxis.range[0]'] !== undefined) bounds = [event['xaxis.range[0]'], event['xaxis.range[1]']] as (string | number)[];
    if (event['xaxis.autorange']) { this.zone.run(() => this.fullRange()); return; }
    if (!bounds || bounds.length !== 2) return;
    const millis = (value: string | number) => typeof value === 'number' ? value : timeMillis(value.replace(' ', 'T'));
    const range = playbackRange(this.times, millis(bounds[0]), millis(bounds[1]));
    this.zone.run(() => {
      if (range) this.applyRange(...range);
      else {
        const middle = (millis(bounds![0]) + millis(bounds![1])) / 2;
        const closest = this.times.reduce((best, time, index) => Math.abs(timeMillis(time) - middle) < Math.abs(timeMillis(this.times[best]) - middle) ? index : best, 0);
        this.applyRange(closest, closest);
      }
    });
  };

  private updateChart(): void {
    if (!this.chart || this.destroyed || !this.times.length) return;
    this.chartTask = this.chartTask.then(async () => {
      if (this.destroyed || !this.chart) return;
      if (!this.plotlyLoading) this.plotlyLoading = import('plotly.js-basic-dist-min').then(module => module.default || module);
      this.plotly = await this.plotlyLoading;
      if (this.destroyed) return;
      const x = this.times.map((_, index) => this.iso(index));
      const series = this.series;
      const traces: Data[] = [];
      if (series) {
        const sx = series.times;
        if (series.ensemble) {
          traces.push({x: sx, y: series.lower, type: 'scatter', mode: 'lines', line: {width: 0}, showlegend: false, hoverinfo: 'skip'});
          traces.push({x: sx, y: series.upper, type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(70,130,180,0.25)', line: {width: 0}, name: 'P10–P90 spread', legendrank: 3});
          traces.push({x: sx, y: series.mean, type: 'scatter', mode: 'lines', line: {color: 'royalblue', width: 2}, name: 'Mean', legendrank: 1});
          traces.push({x: sx, y: series.median, type: 'scatter', mode: 'lines', line: {color: 'navy', width: 2}, name: 'Median', legendrank: 2});
        } else traces.push({x: sx, y: series.concentration, type: 'scatter', mode: 'lines', line: {color: 'navy', width: 2}, name: 'Concentration'});
      } else traces.push({x, y: x.map(() => null), type: 'scatter', showlegend: false, hoverinfo: 'skip'});
      const layout: Partial<Layout> = {
        autosize: true, margin: {l: 65, r: 20, t: 12, b: 42},
        font: {size: 11}, hovermode: 'x unified',
        xaxis: {type: 'date', autorange: false, range: this.axisRange(), rangeslider: {visible: true, range: this.times.length === 1 ? this.axisRange() : [timeMillis(this.times[0]), timeMillis(this.times[this.times.length - 1])], thickness: 0.12, bgcolor: '#f3f4f6', bordercolor: '#cbd5e1', borderwidth: 1}, gridcolor: '#ddd', griddash: 'dash', title: {text: 'Time (UTC)'}},
        yaxis: {title: {text: `Concentration (${series?.unit || this.unit})`}, fixedrange: true, rangemode: 'tozero', gridcolor: '#ddd', griddash: 'dash'},
        legend: {orientation: 'v', traceorder: 'normal', x: 0.98, xanchor: 'right', y: 0.98, yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', title: series?.ensemble ? {text: `Ensemble count = ${series.memberCount}`} : undefined},
        shapes: [this.cursor()], uirevision: `${this.outputId}-${this.layer}-${this.seriesToken}`
      };
      this.suppressRangeEvent = true;
      try {
        await this.plotly.react(this.chart, traces, layout, {responsive: true, displayModeBar: false, scrollZoom: false});
        if (!this.chartInitialized) (this.chart as PlotlyHTMLElement).on('plotly_relayout', event => this.onRangeChanged(event as unknown as Record<string, unknown>));
        this.chartInitialized = true;
      } finally { this.suppressRangeEvent = false; }
    }).catch(() => {
      if (!this.destroyed) {
        this.seriesError = 'Unable to display the animation chart. Close the animation and try again.';
        this.cdr.markForCheck();
      }
    });
  }

  private placeMarker(latitude: number, longitude: number): void {
    if (!this.locationMarker) {
      this.locationMarker = marker([latitude, longitude], {draggable: true, pmIgnore: true}).addTo(this.mapService.leafletMap);
      this.locationMarker.bindTooltip('Animation time-series location');
      this.locationMarker.on('dragend', () => this.zone.run(() => {
        const point = this.locationMarker!.getLatLng();
        this.coordinates.setValue({latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6))});
        this.loadSeries();
      }));
    } else this.locationMarker.setLatLng([latitude, longitude]);
  }

  private pickLocation = (event: LeafletMouseEvent) => this.zone.run(() => {
    this.cancelPick();
    const latitude = Number(event.latlng.lat.toFixed(6)), longitude = Number(event.latlng.wrap().lng.toFixed(6));
    this.coordinates.setValue({latitude, longitude});
    this.loadSeries();
  });

  pickOnMap(): void {
    if (this.picking) { this.cancelPick(); return; }
    const map = this.mapService.leafletMap;
    map.pm.disableDraw();
    map.getContainer().classList.add('ensemble-pick-location');
    map.once('click', this.pickLocation);
    this.picking = true;
  }

  cancelPick(): void {
    const map = this.mapService.leafletMap;
    if (map) {
      map.off('click', this.pickLocation);
      map.getContainer().classList.remove('ensemble-pick-location');
    }
    this.picking = false;
    this.cdr.markForCheck();
  }

  loadSeries(): void {
    if (this.coordinates.invalid) return;
    const {latitude, longitude} = this.coordinates.getRawValue();
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.seriesRequest?.unsubscribe();
    const token = ++this.seriesToken;
    this.placeMarker(latitude, longitude);
    this.seriesLoading = true;
    this.seriesError = '';
    const dimensions = {...this.dimensions};
    delete dimensions['Ti'];
    if ('height' in dimensions) dimensions['height'] = Number(dimensions['height']);
    this.seriesRequest = this.flexpart.getAnimationSeries(this.outputId, this.layer, latitude, longitude, dimensions).pipe(timeout(90000)).subscribe({
      next: series => {
        if (this.destroyed || token !== this.seriesToken) return;
        this.series = series;
        this.applyRange(0, this.times.length - 1);
        this.seriesLoading = false;
        this.updateChart();
        this.cdr.markForCheck();
      },
      error: () => {
        this.seriesError = 'Unable to read this location. Choose a point inside the simulation grid and try again.';
        this.seriesLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  formatTick(value: number): string { return value < 0.01 || value >= 10000 ? value.toExponential(1) : Number(value.toPrecision(3)).toString(); }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopResize();
    this.frameRequest?.unsubscribe();
    this.seriesRequest?.unsubscribe();
    this.coordinateChanges.unsubscribe();
    this.cancelPick();
    clearTimeout(this.timer);
    clearTimeout(this.loadTimer);
    this.frameToken++;
    this.pendingLayer?.remove();
    this.currentLayer?.remove();
    this.locationMarker?.remove();
    this.observer?.disconnect();
    if (this.plotly && this.chartInitialized && this.chart) this.plotly.purge(this.chart);
    this.view?.destroy();
    this.dock?.remove();
    this.legend?.remove();
    const element = this.mapService.leafletMap?.getContainer();
    element?.classList.remove('animation-active');
    this.mapService.leafletMap?.invalidateSize({pan: false});
    this.mapService.animationActive = false;
    if (this.initialMapView) this.mapService.leafletMap.setView(this.initialMapView.center, this.initialMapView.zoom, {animate: false});
    if (this.plotsHidden) {
      const actions = this.hiddenPlotIds.map(id => new MapPlotAction.Show(id));
      if (actions.length) this.store.dispatch(actions);
    }
  }
}
