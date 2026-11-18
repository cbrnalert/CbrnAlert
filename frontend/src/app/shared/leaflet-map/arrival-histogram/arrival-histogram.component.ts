import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { CircleMarker, circleMarker, DomEvent, LeafletMouseEvent, Map as LeafletMap } from 'leaflet';
import type { Data, Layout } from 'plotly.js';
import { MapPlot } from 'src/app/core/models/map-plot';
import { arrivalDistribution, ArrivalDistribution, arrivalHistogramWindow, HISTOGRAM_BAR_FRACTION, maximumDistribution } from './arrival-distribution';

@Component({selector:'app-arrival-histogram', templateUrl:'./arrival-histogram.component.html', styleUrls:['./arrival-histogram.component.scss'], changeDetection:ChangeDetectionStrategy.OnPush})
export class ArrivalHistogramComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() plot: MapPlot;
  @Input() map: LeafletMap;
  @ViewChild('chart') chart: ElementRef<HTMLElement>;
  distribution?: ArrivalDistribution;
  pinned = false;
  minimized = false;
  error = '';
  private initialized = false;
  private destroyed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: {longitude:number;latitude:number};
  private marker?: CircleMarker;
  private plotly?: typeof import('plotly.js');
  private library?: Promise<typeof import('plotly.js')>;
  private renderTask: Promise<void> = Promise.resolve();
  private observer?: ResizeObserver;
  private lastPlotId?: number;

  constructor(private element: ElementRef<HTMLElement>, private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.initialized = true;
    DomEvent.disableClickPropagation(this.element.nativeElement);
    DomEvent.disableScrollPropagation(this.element.nativeElement);
    this.zone.runOutsideAngular(() => {
      this.map.on('mousemove', this.onMove);
      this.map.on('click', this.onPin);
      this.map.on('contextmenu', this.onPin);
      this.observer = new ResizeObserver(() => {
        if (this.plotly && !this.minimized && this.hasDistributionChart) void this.plotly.Plots.resize(this.chart.nativeElement);
      });
      this.observer.observe(this.element.nativeElement);
    });
  }

  ngOnChanges(): void {
    if (this.lastPlotId !== this.plot.id) {
      this.lastPlotId = this.plot.id;
      this.pinned = false;
      this.distribution = undefined;
      this.marker?.remove(); this.marker = undefined;
      clearTimeout(this.timer); this.timer = undefined; this.pending = undefined;
      if (this.initialized && this.plotly) this.plotly.purge(this.chart.nativeElement);
    }
  }

  get isDuration(): boolean { return this.plot.agreementInfo?.analysis === 'duration'; }
  get isMaximum(): boolean { return this.plot.agreementInfo?.analysis === 'maximum'; }
  get isConcentration(): boolean { return this.isMaximum || this.plot.agreementInfo?.analysis === 'timestep'; }
  get histogramTitle(): string { return this.isDuration ? 'Duration above threshold' : this.isMaximum ? 'Maximum concentration' : this.isConcentration ? 'Concentration' : 'Arrival distribution'; }
  get hasDistributionChart(): boolean { return !!this.distribution?.inside && !!(this.distribution.times.length || this.distribution.maximum); }

  private onMove = (event: LeafletMouseEvent) => {
    if (this.pinned) return;
    this.pending = {longitude:event.latlng.lng,latitude:event.latlng.lat};
    if (this.timer) return;
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        const point = this.pending;
        if (!point || this.destroyed || this.pinned) return;
        this.zone.run(() => this.select(point.longitude, point.latitude));
      }, 100);
    });
  };

  private onPin = (event: LeafletMouseEvent) => this.zone.run(() => {
    clearTimeout(this.timer); this.timer = undefined;
    this.select(event.latlng.lng, event.latlng.lat);
    if (this.distribution?.inside) { this.pinned = true; this.placeMarker(); this.cdr.markForCheck(); }
  });

  private select(longitude:number, latitude:number): void {
    const distribution = (this.isConcentration || this.isDuration) ? maximumDistribution(this.plot,longitude,latitude) : arrivalDistribution(this.plot,longitude,latitude);
    if (distribution.key === this.distribution?.key) return;
    this.distribution = distribution;
    this.error = '';
    this.render();
    this.cdr.markForCheck();
  }

  togglePin(): void {
    this.pinned = !this.pinned;
    if (this.pinned) this.placeMarker();
    else { this.marker?.remove(); this.marker = undefined; }
  }

  private placeMarker(): void {
    if (!this.distribution?.inside) return;
    const point: [number,number] = [this.distribution.latitude!,this.distribution.longitude!];
    if (!this.marker) this.marker = circleMarker(point,{radius:5,color:'#1e3a8a',fillColor:'white',fillOpacity:1,weight:2,interactive:false}).addTo(this.map);
    else this.marker.setLatLng(point);
  }

  private render(): void {
    const distribution = this.distribution;
    this.renderTask = this.renderTask.then(async () => {
      if (this.destroyed || distribution !== this.distribution || !distribution) return;
      if (!this.library) this.library = import('plotly.js-basic-dist-min').then(module=>module.default||module);
      this.plotly = await this.library;
      if (this.destroyed || distribution !== this.distribution) return;
      const times = distribution.times, peak = distribution.maximum;
      if ((!times.length && !peak) || !distribution.inside) { this.plotly.purge(this.chart.nativeElement); return; }
      const maximum = Math.max(1,...distribution.counts);
      let axis: Partial<import('plotly.js').LayoutAxis>;
      let traces: Data[];
      let markers: {position: string|number|undefined;name:string;color:string;dash:'solid'|'dash';rank:number}[];
      if (peak) {
        traces=[{type:'bar',x:peak.centers,y:distribution.counts,width:peak.widths,
          customdata:distribution.counts.map((_,i)=>[peak.edges[i],peak.edges[i+1]]),
          marker:{color:peak.colors,line:{color:'#234e70',width:1}},showlegend:false,
          hovertemplate:`${this.isDuration?'Duration':this.isMaximum?'Maximum':'Concentration'} %{customdata[0]:.3g}–%{customdata[1]:.3g} ${peak.unit}<br>%{y} members<extra></extra>`}];
        axis={type:'linear',range:peak.range,title:{text:`${this.isDuration?'Duration above threshold':this.isMaximum?'Maximum concentration':'Concentration'} (${peak.unit})`,font:{size:10},standoff:0},tickangle:0,tickformat:'.3~g'};
        markers=[{position:peak.lower,name:'P10',color:'#5b8db8',dash:'dash',rank:1},
          {position:peak.upper,name:'P90',color:'#234e70',dash:'dash',rank:3},
          {position:peak.median,name:'Median',color:'navy',dash:'solid',rank:2},
          ...(this.isDuration ? [] : [{position:peak.threshold,name:'Threshold',color:'#b91c1c',dash:'solid' as const,rank:0}])];
      } else {
        const milliseconds = times.map(Date.parse);
        const widths = milliseconds.map((time,index) => HISTOGRAM_BAR_FRACTION * Math.min(
          index ? time-milliseconds[index-1] : (milliseconds[1]-time || 3600000),
          index+1<milliseconds.length ? milliseconds[index+1]-time : (time-milliseconds[index-1] || 3600000)));
        traces=[{type:'bar',x:times,y:distribution.counts,width:widths,marker:{color:'#5b8db8',line:{color:'#234e70',width:1}},showlegend:false,
          hovertemplate:'%{x|%d %b %H:%M} UTC<br>%{y} members<extra></extra>'}];
        markers=[{position:distribution.lower,name:'P10',color:'#5b8db8',dash:'dash',rank:1},
          {position:distribution.upper,name:'P90',color:'#234e70',dash:'dash',rank:3},
          {position:distribution.median,name:'Median',color:'navy',dash:'solid',rank:2}];
        const plotWindow=arrivalHistogramWindow(times);
        const tickLabels=plotWindow.ticks.map((time,index)=>{
          const date=new Date(time),hour=date.toISOString().slice(11,16);
          return index===0?`${hour}<br>${new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'}).format(date)}`:hour;
        });
        axis={type:'date',range:plotWindow.range,tickmode:'array',tickvals:plotWindow.ticks,ticktext:tickLabels,tickangle:0,title:{text:'Arrival time (UTC)',font:{size:10},standoff:0}};
      }
      for (const marker of markers) if (marker.position !== undefined) traces.push({type:'scatter',mode:'lines',x:[marker.position,marker.position],y:[0,maximum*1.08],
        name:marker.name,legendrank:marker.rank,line:{color:marker.color,dash:marker.dash,width:marker.name==='Median'?2:marker.name==='Threshold'?1.5:1},hoverinfo:'skip'});
      const layout: Partial<Layout> = {autosize:true,margin:{l:35,r:10,t:24,b:38},font:{size:10},
        xaxis:{...axis,fixedrange:true,showgrid:true,gridcolor:'rgba(209,213,219,0.5)',griddash:'dash'},
        yaxis:{title:{text:'Members',font:{size:10}},range:[0,maximum*1.15],dtick:maximum<=5?1:undefined,fixedrange:true,showgrid:true,gridcolor:'rgba(209,213,219,0.5)',griddash:'dash'},
        legend:{orientation:'h',x:1,xanchor:'right',y:1.2,font:{size:peak?9:10},traceorder:'normal'},bargap:.15};
      await this.plotly.react(this.chart.nativeElement,traces,layout,{responsive:true,displayModeBar:false,staticPlot:false});
    }).catch(() => {
      if (this.destroyed) return;
      this.zone.run(()=>{this.error='Unable to display distribution.';this.cdr.markForCheck();});
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.map.off('mousemove',this.onMove);
    this.map.off('click',this.onPin);
    this.map.off('contextmenu',this.onPin);
    this.observer?.disconnect(); this.marker?.remove();
    if (this.plotly) this.plotly.purge(this.chart.nativeElement);
  }
}
