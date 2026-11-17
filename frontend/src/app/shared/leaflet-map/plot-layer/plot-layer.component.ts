import { MapService } from 'src/app/core/services/map.service';
import { Select, Store } from '@ngxs/store';
import { Component, OnInit, ChangeDetectionStrategy, Input, OnDestroy } from '@angular/core';
import { Feature, FeatureCollection } from 'geojson';
import { FeatureGroup, Layer, LayerGroup, TileLayer } from 'leaflet';
import { ColorbarData } from 'src/app/core/api/models';
import { MapPlot } from 'src/app/core/models/map-plot';
import { MapPlotsService } from 'src/app/core/services/map-plots.service';
import { MapPlotState, MapPlotAction } from 'src/app/core/state/map-plot.state';
import { Observable, Subscription, combineLatest  } from 'rxjs';

@Component({
  selector: 'app-plot-layer',
  template: `
			<div *ngIf="layer && visible" [leafletLayer]="layer"></div>
		`,
  styles: [`

		`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlotLayerComponent implements OnInit, OnDestroy {
  @Input() mapPlot: MapPlot;
  @Input() visible = true;

  @Select(MapPlotState.activePlot) activePlot$: Observable<MapPlot>;

  layer: FeatureGroup | TileLayer;
  sub: Subscription;

  constructor(
    public mapPlotsService: MapPlotsService,
    public store: Store,
    private mapService: MapService
    ) {}

  private isContourPlot(plot: MapPlot): boolean {
    return plot.type === 'stats' && !['percentage agreement', 'arrival time'].includes(plot.legendLayer);
  }

  ngOnInit(): void {
    if (this.mapPlot.type == 'flexpart' || this.mapPlot.type == 'stats') {
      if (this.mapPlot.geojson !== undefined) {
        this.layer = this.mapPlotsService.flexpartPlotToLayer(this.mapPlot.geojson as FeatureCollection);
        this.mapPlotsService.setColors(this.layer as LayerGroup, this.mapPlot.metadata as ColorbarData);
        this.sub = combineLatest([this.activePlot$, this.mapService.overlayOpacity$]).subscribe(([, opacity]) => {
          (this.layer as FeatureGroup).setStyle({opacity, fillOpacity: opacity});
        });
      } else {
        if (this.mapPlot.type == 'flexpart' || ["percentage agreement", "arrival time"].includes(this.mapPlot.legendLayer)) {
          this.layer = this.mapPlotsService.addTiff(this.mapPlot.data, this.mapPlot.metadata as ColorbarData, this.mapPlot.legendLayer === 'arrival time') as unknown as TileLayer;
        } else {
          this.layer = this.mapPlotsService.addTiffMask(this.mapPlot.data) as unknown as TileLayer;
          this.layer.setZIndex(1500);
        }
        this.sub = combineLatest([this.activePlot$, this.mapService.overlayOpacity$]).subscribe(([plot, opacity]) => {
          const layer = this.layer as TileLayer;
          layer.setOpacity(opacity);
          layer.setZIndex(this.isContourPlot(this.mapPlot) ? 1500 : (plot?.id === this.mapPlot.id ? 1000 : 500));
        });
      }

      this.layer.on('click', layer => {
        this.store.dispatch(new MapPlotAction.SetActive(this.mapPlot.id))
      });

    } else if (this.mapPlot.type == 'atp45') {
      let featureGroup = this.mapPlotsService.atp45PlotToLayer(this.mapPlot.geojson as FeatureCollection);
      featureGroup.eachLayer((layers: any) => {
        layers.eachLayer((layer: any) => {
          layer.bindPopup(layer.feature.properties.type)
        })
      })
      this.layer = featureGroup;
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
