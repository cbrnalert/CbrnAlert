import { GeoPoint } from 'src/app/core/api/models';
import { MapPlot } from 'src/app/core/models/map-plot';
import { EventEmitter, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
// import { ShapeData } from 'src/app/atp45/shape-data';
import { Map, Marker, latLng, Rectangle, LatLng, latLngBounds, rectangle, LayerOptions } from 'leaflet';
import { MapArea } from 'src/app/core/models/map-area';

type MapEvent = 'newMarker' | 'areaSelection'
@Injectable({
    providedIn: 'root'
})
export class MapService {

    animationActive = false;

    selectionRectangle?: Rectangle    // refers to area being selected by user
    selectionMarker?: Marker
    retrievedRectangle?: Rectangle     // refers to area for which meteo data has already been retrieved

    mapEventSubject = new Subject<MapEvent>();
    mapPlotEvent = new Subject<number>();
    mapPlotEvent$: Observable<number>;

    leafletMap: Map;

    constructor(
    ) {
        this.mapPlotEvent$ = this.mapPlotEvent.asObservable();
    }

    copyMarkerPosition(pos: Marker) {
      this.selectionMarker!.setLatLng(pos.getLatLng())
      this.leafletMap.removeLayer(pos)
    }

    changeMarkerPosition(newPoint: GeoPoint) {
      if (this.selectionMarker) {
        this.selectionMarker.setLatLng(new LatLng(newPoint.lat, newPoint.lon))
      }
    }

    updateRectangle(area: MapArea, layer: Rectangle) {
      layer.setBounds([[area.bottom, area.left], [area.top, area.right]])
    }

    updateSelectionRectangle(area: MapArea) {
      if (this.selectionRectangle) {
        this.updateRectangle(area, this.selectionRectangle);
      }
    }

    updateRetrievedRectangle(area: MapArea) {
      if (this.retrievedRectangle) {
        this.updateRectangle(area, this.retrievedRectangle);
      } else {
        this.retrievedRectangle = this.areaToRectangle(area, {interactive: false, fillOpacity: 0, color: '#FE04C4'})
        this.retrievedRectangle.addTo(this.leafletMap)
      }
    }

    removeMarker() {
      if (this.selectionMarker) {
        this.leafletMap.removeLayer(this.selectionMarker);
        this.selectionMarker = undefined;
      }
    }

    removeSelectionRectangle() {
      if (this.selectionRectangle) {
        this.leafletMap.removeLayer(this.selectionRectangle);
        this.selectionRectangle = undefined;
      }
    }

    removeRetrievedRectangle() {
      if (this.retrievedRectangle) {
        this.leafletMap.removeLayer(this.retrievedRectangle);
        this.retrievedRectangle = undefined;
      }
    }

    markerToPoint(marker: Marker): GeoPoint {
      const latlng = marker.getLatLng()
      return {
        lon: latlng.lng,
        lat: latlng.lat
      }
    }

    rectangleToArea(rect: Rectangle): MapArea {
      const bounds = rect.getBounds()
      const nw = bounds.getNorthWest();
      const se = bounds.getSouthEast();
      return {
        top: nw.lat,
        bottom: se.lat,
        left: nw.lng,
        right: se.lng,
      }
    }

    areaToRectangle(area: MapArea, options: {}): Rectangle {
      const corner1 = latLng(area.bottom, area.left);
      const corner2 = latLng(area.top, area.right);
      const bounds = latLngBounds(corner1, corner2);
      return rectangle(bounds, options);
    }

    emitEventSubject(event: MapEvent) {
        this.mapEventSubject.next(event);
    }

}
