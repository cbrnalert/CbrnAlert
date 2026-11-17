import { ArrivalHistogramComponent } from './arrival-histogram/arrival-histogram.component';
import { LeafletMapComponent } from './leaflet-map.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LeafletModule } from '@asymmetrik/ngx-leaflet';
import { PlotLayerComponent } from './plot-layer/plot-layer.component';
import { LegendColorbarComponent } from './legend-colorbar/legend-colorbar.component';



@NgModule({
  declarations: [
    ArrivalHistogramComponent,
    LeafletMapComponent,
    PlotLayerComponent,
    LegendColorbarComponent
  ],
  imports: [
    CommonModule,
    LeafletModule
  ],
  exports: [
    LeafletMapComponent
  ]
})
export class LeafletMapModule { }
