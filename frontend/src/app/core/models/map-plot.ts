import { AgreementInfo } from './ensemble-agreement';
import { FeatureCollection } from "geojson";

export type PlotType = 'atp45' | 'flexpart' | 'stats';
export type SimType = 'deterministic' | 'ensemble';

type PlotCount = {
  [K in PlotType]: number;
}

export interface ParameterEntry {
  [parameterName: string]: {
    index: number,
    value: string | number
  }
}

export interface MapPlot {
  type: PlotType,
  name: string,
  id: number,
  simType?: SimType,
  data?: any,
  geojson?: FeatureCollection | FeatureCollection[],
  fpOutputId?: string,
  visible: boolean,
  isActive: boolean,
  legendLayer: string,
  selectedParams?: ParameterEntry,
  agreementInfo?: AgreementInfo,
  metadata?: Object
}

export class MapPlot implements MapPlot {

  static plotsCount : PlotCount = {
    'atp45': 1,
    'flexpart': 1,
    'stats': 1
  }
  static _id = 0;

  name: string;
  visible = true;
  isActive = true;

  constructor(public type: PlotType) {
    if (type === "stats") {
      this.name = "Plot " + (MapPlot.plotsCount["flexpart"] - 1);
    } else {
      this.name = "Plot " + MapPlot.plotsCount[type]
    }
    this.id = MapPlot._id;

    MapPlot._id++;
    MapPlot.plotsCount[type]++;
  }

  getLegendLayer():string {
    return this.legendLayer
  }

  setLegendLayer(layer:string):void {
    this.legendLayer = layer
  }
}
