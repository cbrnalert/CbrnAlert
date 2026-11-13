import { AfterViewInit, ChangeDetectorRef, Component, EventEmitter, Injectable, Input, OnChanges, OnDestroy, Output, TemplateRef, ViewChild, ViewContainerRef } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Store } from '@ngxs/store';
import { Subscription, switchMap, timeout } from 'rxjs';
import { FlexpartService } from '../flexpart.service';
import { MapPlotAction, MapPlotState } from 'src/app/core/state/map-plot.state';
import { MapPlot, ParameterEntry } from 'src/app/core/models/map-plot';

interface AnalysisState {
  mode: 'timestep' | 'period'; startIndex: number; endIndex: number; calculatedDescription?: string;
  parentName: string; threshold: string; calculatedThreshold?: number; ready: boolean;
  agreement: boolean; members: string; selected: number[]; hiddenIds: number[];
}
@Injectable({providedIn: 'root'})
export class EnsembleAnalysisCache {
  states = new Map<string, AnalysisState>();
}

@Component({
  selector: 'app-ensemble-analysis',
  templateUrl: './ensemble-analysis.component.html',
  styleUrls: ['./ensemble-analysis.component.scss']
})
export class EnsembleAnalysisComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() outputId: string;
  @Input() layer: string;
  @Input() substance: string;
  @Input() dimensions: {[key: string]: string | number};
  @Input() availableDimensions: {[key: string]: (string | number)[]};
  @Output() closed = new EventEmitter<void>();
  @ViewChild('panel') panel: TemplateRef<unknown>;
  state: AnalysisState;
  loading = false;
  error = '';
  memberError = '';
  minimized = false;
  informationVisible = false;
  private parentName = '';
  private params: ParameterEntry = {};
  private overlayRef?: OverlayRef;
  private request?: Subscription;
  private destroyed = false;

  constructor(private flexpart: FlexpartService, private store: Store, private cache: EnsembleAnalysisCache,
    private overlay: Overlay, private viewContainer: ViewContainerRef, private cdr: ChangeDetectorRef) {}

  get unit(): string { return /spec\d+_mr/.test(this.layer) ? 'ng/m³' : /D_spec/.test(this.layer) ? 'ng/m²' : ''; }
  get validThreshold(): boolean { return this.state.threshold.trim() !== '' && Number.isFinite(Number(this.state.threshold)) && Number(this.state.threshold) > 0; }
  get timestep(): string { return String(this.dimensions['Ti'] || ''); }

  get times(): (string | number)[] { return this.availableDimensions['Ti'] || []; }
  get validPeriod(): boolean { return this.state.mode === 'timestep' || (this.times.length > 0 && this.state.startIndex >= 0 && this.state.endIndex < this.times.length && this.state.startIndex <= this.state.endIndex); }
  formatTime(time: string | number): string { return String(time).replace('T', ' ').slice(0, 16) + ' UTC'; }

  changeMode(value: string): void {
    this.invalidateResults();
    this.state.mode = value === 'period' ? 'period' : 'timestep';
  }

  get startPercent(): number { return this.times.length > 1 ? 100 * this.state.startIndex / (this.times.length - 1) : 0; }
  get endPercent(): number { return this.times.length > 1 ? 100 * this.state.endIndex / (this.times.length - 1) : 100; }

  changePeriod(edge: 'startIndex' | 'endIndex', value: string): void {
    const requested = Number(value);
    const index = edge === 'startIndex' ? Math.min(requested, this.state.endIndex) : Math.max(requested, this.state.startIndex);
    if (index === this.state[edge]) return;
    this.invalidateResults();
    this.state[edge] = index;
  }

  private invalidateResults(): void {
    this.request?.unsubscribe();
    this.loading = false;
    this.toggleAgreement(false);
    this.visibility(this.resultPlots(), false);
    this.state.ready = false;
    this.state.members = '';
    this.state.selected = [];
    this.error = this.memberError = '';
  }

  ngOnChanges(): void {
    this.request?.unsubscribe();
    this.loading = false;
    this.error = this.memberError = '';
    this.params = {substance: {index: 1, value: this.substance}};
    for (const key of ['Ti', 'height']) {
      const values = this.availableDimensions[key];
      if (values) this.params[key] = {index: values.findIndex(value => String(value) === String(this.dimensions[key])) + 1, value: this.dimensions[key]};
    }
    const key = JSON.stringify([this.outputId, this.layer, this.dimensions]);
    if (!this.cache.states.has(key)) this.cache.states.set(key, {mode: 'timestep', startIndex: 0, endIndex: (this.availableDimensions['Ti']?.length || 1) - 1, parentName: `Ensemble analysis ${this.cache.states.size + 1}`, threshold: '', ready: false, agreement: false, members: '', selected: [], hiddenIds: []});
    this.state = this.cache.states.get(key)!;
    this.parentName = this.state.parentName;
    const plots = this.store.selectSnapshot(MapPlotState.mapPlots);
    for (const other of this.cache.states.values()) {
      if (other === this.state) continue;
      this.visibility(plots.filter(plot => other.hiddenIds.includes(plot.id)), true);
      this.visibility(plots.filter(plot => plot.type === 'stats' && plot.name.startsWith(other.parentName + ' - ')), false);
      const restored = other.hiddenIds[other.hiddenIds.length - 1];
      if (restored !== undefined) this.store.dispatch(new MapPlotAction.SetActive(restored));
      other.hiddenIds = [];
      other.agreement = false;
      other.members = '';
      other.selected = [];
    }
    // New map plots hide statistics; reflect actual visibility when reopening the panel.
    const visible = this.resultPlots().filter(plot => plot.visible);
    this.state.agreement = visible.some(plot => plot.legendLayer === 'percentage agreement');
    if (!this.state.agreement) this.state.hiddenIds = [];
    this.state.selected = visible.filter(plot => /^member \d+$/.test(plot.legendLayer)).map(plot => Number(plot.legendLayer.slice(7)));
    if (!this.state.selected.length) this.state.members = '';
  }

  ngAfterViewInit(): void {
    this.overlayRef = this.overlay.create({positionStrategy: this.overlay.position().global().right('20px').top('90px'), hasBackdrop: false, scrollStrategy: this.overlay.scrollStrategies.noop()});
    this.overlayRef.attach(new TemplatePortal(this.panel, this.viewContainer));
  }

  private resultPlots(): MapPlot[] {
    return this.store.selectSnapshot(MapPlotState.mapPlots).filter(plot => plot.type === 'stats' && plot.name.startsWith(this.parentName + ' - '));
  }

  private visibility(plots: MapPlot[], show: boolean): void {
    const actions = plots.map(plot => show ? new MapPlotAction.Show(plot.id) : new MapPlotAction.Hide(plot.id));
    if (actions.length) this.store.dispatch(actions);
  }

  toggleAgreement(checked: boolean): void {
    this.state.agreement = checked;
    const plots = this.store.selectSnapshot(MapPlotState.mapPlots);
    if (checked) {
      this.state.hiddenIds = plots.filter(plot => plot.type === 'flexpart' && plot.visible).map(plot => plot.id);
      this.visibility(plots.filter(plot => this.state.hiddenIds.includes(plot.id)), false);
    } else {
      this.visibility(plots.filter(plot => this.state.hiddenIds.includes(plot.id)), true);
      const restored = this.state.hiddenIds[this.state.hiddenIds.length - 1];
      this.state.hiddenIds = [];
      if (restored !== undefined) this.store.dispatch(new MapPlotAction.SetActive(restored));
    }
    this.visibility(this.resultPlots().filter(plot => plot.legendLayer === 'percentage agreement'), checked);
    const agreement = this.resultPlots().find(plot => plot.legendLayer === 'percentage agreement');
    if (checked && agreement) this.store.dispatch(new MapPlotAction.SetActive(agreement.id));
  }

  selectMembers(value: string): void {
    this.state.members = value;
    const available = this.resultPlots().filter(plot => /^member \d+$/.test(plot.legendLayer));
    const numbers = available.map(plot => Number(plot.legendLayer.slice(7)));
    const text = value.trim();
    const tokens = text ? text.split(',').map(token => token.trim()) : [];
    const all = text.toLowerCase() === 'all';
    const selected = all ? numbers : [...new Set(tokens.map(Number))];
    if (!all && (!tokens.every(token => /^\d+$/.test(token)) || !selected.every(number => numbers.includes(number)))) {
      this.memberError = 'Enter available member numbers separated by commas, or all.';
      return;
    }
    this.memberError = '';
    this.state.selected = selected;
    this.visibility(available.filter(plot => !selected.includes(Number(plot.legendLayer.slice(7)))), false);
    this.visibility(available.filter(plot => selected.includes(Number(plot.legendLayer.slice(7)))), true);
  }

  calculate(): void {
    if (!this.validThreshold || !this.validPeriod || this.loading) return;
    this.toggleAgreement(false);
    this.visibility(this.resultPlots(), false);
    this.state.members = '';
    this.state.selected = [];
    this.state.ready = false;
    this.error = this.memberError = '';
    const threshold = Number(this.state.threshold);
    this.state.calculatedThreshold = threshold;
    const indices: {[key: string]: number} = {};
    for (const key of ['Ti', 'height']) if (this.params[key]) indices[key] = this.params[key].index;
    const period = this.state.mode === 'period';
    const params = {...this.params};
    const description = period ? `At any time: ${this.formatTime(this.times[this.state.startIndex])} – ${this.formatTime(this.times[this.state.endIndex])}` : `At timestep: ${this.formatTime(this.timestep)}`;
    this.state.calculatedDescription = description;
    if (period) {
      indices['Ti'] = this.state.startIndex + 1;
      indices['TiEnd'] = this.state.endIndex + 1;
      params['Ti'] = {index: indices['Ti'], value: description};
    }
    this.loading = true;
    const calculation = period ? this.flexpart.getPeriodAgreement(this.outputId, this.layer, indices, threshold).pipe(
      switchMap(result => this.store.dispatch(new MapPlotAction.AddPeriodAgreement(result, params, this.parentName, threshold, this.unit)))) :
      this.flexpart.getEnsembleStats(this.outputId, this.layer, indices, threshold).pipe(
        switchMap(result => this.store.dispatch(new MapPlotAction.AddStatsTiff(result, 'stats', [`percentage agreement (${threshold} ${this.unit})`], params, this.parentName))));
    this.request = calculation.pipe(timeout(180000)).subscribe({
      next: () => {
        if (this.destroyed) return;
        this.loading = false;
        this.state.ready = true;
        if (period) this.toggleAgreement(true);
        this.cdr.markForCheck();
      },
      error: () => {
        if (this.destroyed) return;
        this.loading = false;
        this.error = 'Unable to calculate statistics. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.request?.unsubscribe();
    this.overlayRef?.dispose();
  }
}
