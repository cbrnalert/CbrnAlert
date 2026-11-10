import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { CdkDrag } from '@angular/cdk/drag-drop';
import { ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, AfterViewInit, Output, TemplateRef, ViewChild, ViewContainerRef } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Subscription, timeout, TimeoutError } from 'rxjs';
import { LeafletMouseEvent, Marker, marker } from 'leaflet';
import type {} from '@geoman-io/leaflet-geoman-free';
import { FlexpartService } from '../flexpart.service';
import { MapService } from 'src/app/core/services/map.service';

@Component({
  selector: 'app-ensemble-plot',
  templateUrl: './ensemble-plot.component.html',
  styleUrls: ['./ensemble-plot.component.scss']
})
export class EnsemblePlotComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();
  @ViewChild('floatingPanel') floatingPanel: TemplateRef<unknown>;
  minimized = false;
  expanded = false;
  editingLocation = true;
  panelWidth: number | null = null;
  panelHeight: number | null = null;
  readonly resizeEdges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  private resizeState?: { edge: string; pointerId: number; x: number; y: number; bounds: DOMRect };
  private overlayRef?: OverlayRef;
  @Input() isEnsemble = true;
  @Input() outputId: string;
  @Input() layer: string;
  @Input() dimensions: {[key: string]: string | number};
  coordinates = new FormGroup({
    latitude: new FormControl<number | null>(null, [Validators.required, Validators.min(-90), Validators.max(90)]),
    longitude: new FormControl<number | null>(null, [Validators.required, Validators.min(-180), Validators.max(180)])
  });
  loading = false;
  picking = false;
  error = '';
  figureUrl: string | null = null;
  private request?: Subscription;
  private locationMarker?: Marker;
  private coordinateChanges = this.coordinates.valueChanges.subscribe(() => this.clearFigure());

  constructor(
    private flexpart: FlexpartService,
    public mapService: MapService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private overlay: Overlay,
    private viewContainer: ViewContainerRef
  ) {}

  ngAfterViewInit(): void {
    this.overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global().right('16px').bottom('16px'),
      scrollStrategy: this.overlay.scrollStrategies.noop(),
      hasBackdrop: false
    });
    this.overlayRef.attach(new TemplatePortal(this.floatingPanel, this.viewContainer));
  }

  toggleExpanded(drag: CdkDrag): void {
    this.expanded = !this.expanded;
    this.minimized = false;
    drag.reset();
    this.overlayRef?.updatePositionStrategy(this.overlay.position().global().right('16px').bottom('16px'));
  }

  startResize(event: PointerEvent, edge: string, drag: CdkDrag): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = (event.currentTarget as HTMLElement).closest('.ensemble-panel') as HTMLElement;
    const bounds = panel.getBoundingClientRect();
    this.stopResize();
    drag.reset();
    this.expanded = false;
    this.minimized = false;
    this.panelWidth = bounds.width;
    this.panelHeight = bounds.height;
    this.resizeState = { edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds };
    this.overlayRef?.updatePositionStrategy(this.overlay.position().global().left(`${bounds.left}px`).top(`${bounds.top}px`));
    document.addEventListener('pointermove', this.resizePanel);
    document.addEventListener('pointerup', this.stopResize);
    document.addEventListener('pointercancel', this.stopResize);
    window.addEventListener('blur', this.stopResize);
  }

  private resizePanel = (event: PointerEvent) => {
    const state = this.resizeState;
    if (!state || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    this.zone.run(() => {
      const { edge, bounds } = state;
      const dx = event.clientX - state.x, dy = event.clientY - state.y;
      const minWidth = Math.min(320, window.innerWidth - 16);
      const minHeight = Math.min(200, window.innerHeight - 16);
      let { left, right, top, bottom } = bounds;
      if (edge.includes('w')) left = Math.max(8, Math.min(bounds.left + dx, right - minWidth));
      if (edge.includes('e')) right = Math.min(window.innerWidth - 8, Math.max(bounds.right + dx, left + minWidth));
      if (edge.includes('n')) top = Math.max(8, Math.min(bounds.top + dy, bottom - minHeight));
      if (edge.includes('s')) bottom = Math.min(window.innerHeight - 8, Math.max(bounds.bottom + dy, top + minHeight));
      this.panelWidth = right - left;
      this.panelHeight = bottom - top;
      this.overlayRef?.updatePositionStrategy(this.overlay.position().global().left(`${left}px`).top(`${top}px`));
      this.cdr.markForCheck();
    });
  };

  private stopResize = () => {
    this.resizeState = undefined;
    document.removeEventListener('pointermove', this.resizePanel);
    document.removeEventListener('pointerup', this.stopResize);
    document.removeEventListener('pointercancel', this.stopResize);
    window.removeEventListener('blur', this.stopResize);
  };

  ngOnChanges(): void {
    this.clearFigure();
    this.cancelPick();
  }

  private clearFigure(): void {
    this.request?.unsubscribe();
    this.loading = false;
    this.error = '';
    if (this.figureUrl) URL.revokeObjectURL(this.figureUrl);
    this.figureUrl = null;
    this.cdr.markForCheck();
  }

  private placeMarker(latitude: number, longitude: number): void {
    const map = this.mapService.leafletMap;
    if (!map) return;
    if (!this.locationMarker) {
      this.locationMarker = marker([latitude, longitude], {draggable: true, pmIgnore: true}).addTo(map);
      this.locationMarker.bindTooltip('Time-series location');
      this.locationMarker.on('dragend', () => this.zone.run(() => {
        const point = this.locationMarker!.getLatLng();
        this.coordinates.setValue({latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6))});
      }));
    } else this.locationMarker.setLatLng([latitude, longitude]);
  }

  private pickLocation = (event: LeafletMouseEvent) => this.zone.run(() => {
    this.cancelPick();
    const latitude = Number(event.latlng.lat.toFixed(6));
    const longitude = Number(event.latlng.wrap().lng.toFixed(6));
    this.coordinates.setValue({latitude, longitude});
    this.placeMarker(latitude, longitude);
  });

  pickOnMap(): void {
    const map = this.mapService.leafletMap;
    if (!map) return;
    if (this.picking) { this.cancelPick(); return; }
    map.pm.disableDraw();
    this.picking = true;
    this.minimized = false;
    map.getContainer().classList.add('ensemble-pick-location');
    map.once('click', this.pickLocation);
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

  cancelPlot(): void {
    this.clearFigure();
    this.error = 'Plot request cancelled.';
  }

  plot(): void {
    if (!this.coordinates.valid || !this.dimensions || this.loading) return;
    this.clearFigure();
    this.cancelPick();
    const {latitude, longitude} = this.coordinates.getRawValue();
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.placeMarker(latitude, longitude);
    const dimensions = {...this.dimensions};
    delete dimensions['Ti'];
    if ('height' in dimensions) dimensions['height'] = Number(dimensions['height']);
    this.loading = true;
    this.request = this.flexpart.getEnsembleTimeSeries(this.outputId, this.layer, latitude, longitude, dimensions).pipe(timeout(90000)).subscribe({
      next: figure => {
        this.figureUrl = URL.createObjectURL(figure);
        this.loading = false;
        this.editingLocation = false;
        this.cdr.markForCheck();
      },
      error: (error: unknown) => {
        this.loading = false;
        this.cdr.markForCheck();
        if (error instanceof TimeoutError) {
          this.error = 'The plot request timed out after 90 seconds. Check the backend terminal for the time-series progress or error, then try again.';
          return;
        }
        this.error = 'Unable to plot this location. Choose a point inside the simulation grid and check that simulation outputs are complete.';
      }
    });
  }

  ngOnDestroy(): void {
    this.stopResize();
    this.overlayRef?.dispose();
    this.clearFigure();
    this.cancelPick();
    this.coordinateChanges.unsubscribe();
    this.locationMarker?.remove();
  }
}
