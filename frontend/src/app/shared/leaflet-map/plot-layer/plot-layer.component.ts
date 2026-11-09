import { Select, Store } from '@ngxs/store';
import { Component, OnInit, ChangeDetectionStrategy, Input, OnDestroy } from '@angular/core';
import { Feature, FeatureCollection } from 'geojson';
import { FeatureGroup, Layer, LayerGroup, TileLayer } from 'leaflet';
import { ColorbarData } from 'src/app/core/api/models';
import { MapPlot } from 'src/app/core/models/map-plot';
import { MapPlotsService } from 'src/app/core/services/map-plots.service';
import { MapPlotState, MapPlotAction } from 'src/app/core/state/map-plot.state';
import { Observable, Subscription, combineLatestWith  } from 'rxjs';

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
    public store: Store
    ) {}

  private isContourPlot(plot: MapPlot): boolean {
    return plot.type === 'stats' && plot.legendLayer !== 'percentage agreement';
  }

  ngOnInit(): void {
    if (this.mapPlot.type == 'flexpart' || this.mapPlot.type == 'stats') {
      if (this.mapPlot.geojson !== undefined) {
        this.layer = this.mapPlotsService.flexpartPlotToLayer(this.mapPlot.geojson as FeatureCollection);
        this.mapPlotsService.setColors(this.layer as LayerGroup, this.mapPlot.metadata as ColorbarData);
        this.layer.setStyle({ opacity: 0.2 });

        this.sub = this.activePlot$.subscribe(plot => {
          if (plot !== undefined) {
            const layer = this.layer as FeatureGroup
            if (this.mapPlot.id == plot.id) {
              layer.setStyle({ opacity: 0.6 });
            }
          }
        });
      } else {
        if (this.mapPlot.type == 'flexpart' || this.mapPlot.legendLayer == "percentage agreement") {
          this.layer = this.mapPlotsService.addTiff(this.mapPlot.data, this.mapPlot.metadata as ColorbarData) as unknown as TileLayer;
        } else {
          this.layer = this.mapPlotsService.addTiffMask(this.mapPlot.data) as unknown as TileLayer;
          this.layer.setOpacity(0.6);
          this.layer.setZIndex(1500);
        }
        this.sub = this.activePlot$.subscribe(plot => {
          if (plot !== undefined) {
            const layer = this.layer as TileLayer;
            if (this.mapPlot.id == plot.id) {
              layer.setOpacity(0.6);
              layer.setZIndex(1000);
            } else {
              if (!this.isContourPlot(this.mapPlot)) {
                layer.setOpacity(this.mapPlot.legendLayer === 'percentage agreement' ? 0.6 : 0.2);
                layer.setZIndex(500);
              }
            }
          }
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
    this.sub.unsubscribe();
  }
}
