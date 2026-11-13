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
    plot.name = `${action.parentName} - percentage agreement (${action.threshold} ${action.unit})`;
    plot.legendLayer = 'percentage agreement';
    plot.visible = false;
    plot.selectedParams = action.selectedParams;
    plot.data = {values: [r.values.map(row => row.map(value => value === null ? -9999 : value))],
      width: r.width, height: r.height, xmin: r.xmin, xmax: r.xmax, ymin: r.ymin, ymax: r.ymax,
      pixelWidth: (r.xmax-r.xmin)/r.width, pixelHeight: (r.ymax-r.ymin)/r.height,
      projection: 4326, noDataValue: -9999, numberOfRasters: 1, mins: [0], maxs: [100], ranges: [100]};
    plot.metadata = this.mapPlotService._colorbarFromGeoRaster(plot.data, 'stats');
    plot.agreementInfo = {memberCount: r.memberCount, counts: r.counts, validCounts: r.validCounts,
      description: `At any time: ${r.startTime} – ${r.endTime} · ≥ ${action.threshold} ${action.unit}`};
    ctx.setState(produce(draft => {
      draft.mapPlots = draft.mapPlots.filter(p => p.type !== 'stats' || !p.name.startsWith(action.parentName + ' - '));
      draft.mapPlots.push(plot);
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
