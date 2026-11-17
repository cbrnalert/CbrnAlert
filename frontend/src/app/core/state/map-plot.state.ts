import { PeriodAgreement } from '../models/ensemble-agreement';
import { MapPlotsService } from 'src/app/core/services/map-plots.service';
import { Injectable } from '@angular/core';
import { Action, createSelector, Selector, State, StateContext } from '@ngxs/store';
import { MapPlot, PlotType, SimType, ParameterEntry } from 'src/app/core/models/map-plot';
import produce from "immer"
import { Atp45Result, GeoJsonSliceResponse } from '../api/models';
import { DRAFTABLE } from 'immer/dist/internal';

export namespace MapPlotAction {
  export class AddPeriodAgreement {
    static readonly type = '[MapPlot] AddPeriodAgreement';
    constructor(public result: PeriodAgreement, public selectedParams: ParameterEntry, public parentName: string, public threshold: number, public unit: string) {}
  }

  export class Add {
    static readonly type = '[MapPlot] Add'

    constructor(public plotData: GeoJsonSliceResponse | Atp45Result, public type: PlotType, public fpOutputId?: string, public simType?: SimType, public selectedParams?: ParameterEntry) { }
  }

  export class AddTiff {
    static readonly type = '[MapPlot] AddTiff'

    constructor(public plotData: Blob, public type: PlotType, public fpOutputId?: string, public simType?: SimType, public selectedParams?: ParameterEntry) { }
  }

  export class AddStatsTiff {
    static readonly type = '[MapPlot] AddStatsTiff'

    constructor(public plotData: Blob, public type: PlotType, public plotNames: string[], public selectedParams: ParameterEntry, public parentName?: string) { }
  }

  export class Hide {
    static readonly type = '[MapPlot] Hide'

    constructor(public mapPlotId: number) { }
  }

  export class Show {
    static readonly type = '[MapPlot] Show'

    constructor(public mapPlotId: number) { }
  }

  export class SetActive {
    static readonly type = '[MapPlot] SetActive'

    constructor(public mapPlotId: number) { }
  }

  export class SetInactive {
    static readonly type = '[MapPlot] SetInactive'

    constructor(public mapPlotId: number) { }
  }

  export class Remove {
    static readonly type = '[MapPlot] Remove'

    constructor(public mapPlotId: number) { }
  }
}

export class MapPlotStateModel {
  mapPlots: MapPlot[]
  activePlot?: MapPlot;
}

@State<MapPlotStateModel>({
  name: 'mapPlots',
  defaults: {
    mapPlots: [],
    activePlot: undefined
  }
})
@Injectable()
export class MapPlotState {

  constructor(private mapPlotService: MapPlotsService) { }

  @Selector()
  static mapPlots(state: MapPlotStateModel) {
    return state.mapPlots
  }
  
  @Selector()
  static activePlot(state: MapPlotStateModel) {
    return state.activePlot;
  }

  static filterType(type: PlotType) {
    return createSelector([MapPlotState], (state: MapPlotStateModel) => {
      return state.mapPlots.filter(plot => plot.type == type);
    })
  }

  @Action(MapPlotAction.Add)
  add(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.Add) {
    let mapPlot = this.mapPlotService.createMapPlotGeoJSON(action);
    ctx.setState(produce(draft => {
      if (mapPlot.type === 'flexpart') {
        draft.mapPlots.forEach(plot => {
          if (plot.type === 'stats') plot.visible = false;
        });
      }
      draft.mapPlots.push(mapPlot);
    }))

    return ctx.dispatch(new MapPlotAction.SetActive(mapPlot.id))
  }

  @Action(MapPlotAction.AddTiff)
  addTiff(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.AddTiff) {
    return this.mapPlotService.createMapPlotTiff(action).then(res => {
      let mapPlot = res;
      ctx.setState(produce(draft => {
        if (mapPlot.type === 'flexpart') {
          draft.mapPlots.forEach(plot => {
            if (plot.type === 'stats') plot.visible = false;
          });
        }
        draft.mapPlots.push(mapPlot);
      }))

      return ctx.dispatch(new MapPlotAction.SetActive(mapPlot.id))
    });
  }

  @Action(MapPlotAction.AddStatsTiff)
  addStatsTiff(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.AddStatsTiff) {
    return this.mapPlotService.createMapPlotStatsTiff(action).then(res => {
      const statsPlots: MapPlot[] = res;
      if (action.parentName) {
        statsPlots.forEach(plot => plot.name = action.parentName + ' - ' + plot.name.split(' - ').slice(1).join(' - '));
      }
      ctx.setState(produce(draft => {
        if (action.parentName) {
          draft.mapPlots = draft.mapPlots.filter(plot =>
            plot.type !== 'stats' || !plot.name.startsWith(action.parentName + ' - '));
        }
        draft.mapPlots.push(...statsPlots);
      }))
    });
  }

  @Action(MapPlotAction.AddPeriodAgreement)
  addPeriodAgreement(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.AddPeriodAgreement) {
    const r = action.result;
    const plot = new MapPlot('stats');
    const arrival = r.analysis === 'arrival';
    const duration = r.analysis === 'duration';
    plot.legendLayer = duration ? 'duration above threshold' : arrival ? 'arrival time' : 'percentage agreement';
    plot.name = `${action.parentName} - ${plot.legendLayer} (${action.threshold} ${action.unit})`;
    plot.visible = false;
    plot.selectedParams = action.selectedParams;
    plot.data = {values: [r.values.map(row => row.map(value => value === null ? -9999 : value))],
      width: r.width, height: r.height, xmin: r.xmin, xmax: r.xmax, ymin: r.ymin, ymax: r.ymax,
      pixelWidth: (r.xmax-r.xmin)/r.width, pixelHeight: (r.ymax-r.ymin)/r.height,
      projection: 4326, noDataValue: -9999, numberOfRasters: 1, mins: [0], maxs: [100], ranges: [100]};
    if (arrival) {
      plot.data.values.push(r.counts, r.validCounts);
      plot.data.numberOfRasters = 3;
      plot.data.mins = [0, 0, 0]; plot.data.maxs = [Math.max(1e-9, (Date.parse(r.endTime) - Date.parse(r.startTime)) / 3600000), r.memberCount, r.memberCount]; plot.data.ranges = plot.data.maxs;
    }
    let durationScale = 1;
    if (duration) {
      let maximumMedian = 0;
      for (const row of r.values) for (const value of row) {
        if (value !== null && Number.isFinite(value)) maximumMedian = Math.max(maximumMedian, value);
      }
      durationScale = Math.max(1, Math.ceil(maximumMedian));
      plot.data.maxs = [durationScale]; plot.data.ranges = [durationScale];
    }
    plot.metadata = duration ? this.mapPlotService.durationColorbar(durationScale) : arrival ? this.mapPlotService.arrivalColorbar(r.startTime, r.endTime) : this.mapPlotService._colorbarFromGeoRaster(plot.data, 'stats');
    plot.agreementInfo = {analysis: r.analysis, durationHours: r.durationHours, durationValues: r.durationValues, maximumValues: r.maximumValues, concentrationValues: r.concentrationValues, threshold: action.threshold, unit: action.unit, startTime: r.startTime, arrivalLower: r.arrivalLower, arrivalUpper: r.arrivalUpper, arrivalCounts: r.arrivalCounts, arrivalHistogram: r.arrivalHistogram, arrivalTimes: r.arrivalTimes, memberCount: r.memberCount, counts: r.counts, validCounts: r.validCounts,
      description: `${duration ? 'Duration above threshold' : arrival ? 'Arrival time' : 'At any time'}: ${r.startTime} – ${r.endTime} · ≥ ${action.threshold} ${action.unit}`};
    const plots = [plot];
    for (const contour of r.memberContours || []) {
      const member = new MapPlot('stats');
      member.name = `${action.parentName} - member ${contour.member} (${action.threshold} ${action.unit})`;
      member.legendLayer = `member ${contour.member}`;
      member.visible = false;
      member.selectedParams = action.selectedParams;
      const mask = Array.from({length:r.height},()=>Array<number>(r.width).fill(0));
      for (const cell of contour.cells) if (Number.isInteger(cell) && cell>=0 && cell<r.width*r.height) mask[Math.floor(cell/r.width)][cell%r.width]=1;
      member.data = {...plot.data,values:[mask],numberOfRasters:1,mins:[0],maxs:[1],ranges:[1]};
      plots.push(member);
    }
    ctx.setState(produce(draft => {
      draft.mapPlots = draft.mapPlots.filter(p => p.type !== 'stats' || !p.name.startsWith(action.parentName + ' - '));
      draft.mapPlots.push(...plots);
    }));
  }

  @Action(MapPlotAction.Show)
  show(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.Show) {
    ctx.setState(produce(draft => {
      draft.mapPlots.forEach(plt => {
        if (plt.id == action.mapPlotId) {
          // this.mapPlotService.showMapPlot(plt);
          plt.visible = true;
        }
      })
    }))
  }

  @Action(MapPlotAction.Hide)
  hide(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.Hide) {
    ctx.setState(produce(draft => {
      draft.mapPlots.forEach(plt => {
        if (plt.id == action.mapPlotId) {
          // this.mapPlotService.hideMapPlot(plt);
          plt.visible = false;
        }
      })
    }))
  }

  @Action(MapPlotAction.SetActive)
  setActive(ctx: StateContext<MapPlotStateModel>, action: MapPlotAction.SetActive) {
    ctx.setState(produce(draft => {
      const id = action.mapPlotId
      draft.mapPlots.forEach(plt => {
        if (plt.id == id) {
            this.mapPlotService.setActivePlot(plt);
            plt.isActive = true;
        } else {
            plt.isActive = false;
        }
      });
      draft.activePlot = draft.mapPlots.find(plt => plt.id == id);
    }))
  }


  @Action(MapPlotAction.Remove)
  remove(ctx: StateContext<MapPlotStateModel>, { mapPlotId }: MapPlotAction.Remove) {

    ctx.setState(produce(draft => {
      const mapPlots = draft.mapPlots;
      const newMapPlots = mapPlots.filter(a => a.id != mapPlotId);
      let newActive: MapPlot | undefined;
      if (newMapPlots.length == 0) {
        newActive = undefined
      } else {
        const toDel = mapPlots.find(a => a.id == mapPlotId)
        if (toDel?.isActive) {
          newActive = undefined
        }
      }
      draft.mapPlots = newMapPlots;
      draft.activePlot = newActive;
    }))
  }
}
