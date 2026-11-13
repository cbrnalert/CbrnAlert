import { MapAction } from 'src/app/core/state/map.state';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, Input } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { circle, Control, Popup, ControlOptions, LeafletMouseEvent, DomUtil, DomEvent, Icon, icon, latLng, latLngBounds, Layer, Map as LeafletMap, marker, Marker, polygon, Rectangle, tileLayer, LayerGroup, FeatureGroup, TileLayer, LatLngBounds, control } from 'leaflet';
import { dynamicMapLayer, imageMapLayer, ImageMapLayer } from 'esri-leaflet';
import '@geoman-io/leaflet-geoman-free';
import { MapService } from 'src/app/core/services/map.service';
import { Select, Store } from '@ngxs/store';
import { Observable, firstValueFrom, of } from 'rxjs';
import { MapPlotState, MapPlotAction } from 'src/app/core/state/map-plot.state';
import { MapPlot } from 'src/app/core/models/map-plot';
import { map, tap, take } from 'rxjs/operators';
import { MapPlotsService } from 'src/app/core/services/map-plots.service';
import { FlexpartService } from 'src/app/flexpart/flexpart.service';


const iconRetinaUrl = 'assets/marker-icon-2x.png';
const iconUrl = 'assets/marker-icon.png';
const shadowUrl = 'assets/marker-shadow.png';
const iconDefault = icon({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});
Marker.prototype.options.icon = iconDefault;

interface ThresholdControlOptions extends ControlOptions {
  collapsed?: boolean;
  checkboxState?: { [label: string]: boolean };
}

@Component({
  selector: 'app-leaflet-map',
  templateUrl: './leaflet-map.component.html',
  styleUrls: ['./leaflet-map.component.scss'],
})
export class LeafletMapComponent implements OnInit, OnDestroy {

  private routeChanges?: Subscription;
  private updateDrawingControls(): void {
    if (!this.map) return;
    if (this.router.url.includes('/flexpart/plots')) {
      this.map.pm.disableDraw();
      this.map.pm.removeControls();
    } else this.map.pm.addControls();
  }

  ngOnDestroy(): void { this.routeChanges?.unsubscribe(); }

  map: LeafletMap;
  layer: FeatureGroup | TileLayer;
  scalebar: Control.Scale | undefined;
  sameRender: boolean = false;
  popDensityLayer100m: ImageMapLayer;
  popDensityLayer1km: ImageMapLayer;
  currentThresholdCtrl: Control | null = null;
  thresholdControlList = new Map<string, { control: Control, collapsed: boolean, threshold: number | null, plotUnit: string, checkboxState: { [label: string]: boolean }, members?: string, ready?: boolean, hiddenConcentrationIds?: number[] }>();
  currentUnit: string | null;
  private latestFlexpartPlotId = -1;

  options = {
    attributionControl: false, // Disable the default attribution control
  };

  @Select(MapPlotState.mapPlots) mapPlots$: Observable<MapPlot[]>;
  @Select(MapPlotState.activePlot) activePlot$: Observable<MapPlot>;

  renderingRule = {
    "rasterFunction": "Stretch",
    "rasterFunctionArguments": {
      "StretchType": 9,
      "SigmoidStrengthLevel": 1,
      "Min": 0,
      "Max": 60000
    }
  };

  layersControl = {
    baseLayers: {
      'ESRI Satellite Map': tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, detectRetina: true, attribution: 'Esri, USGS | Esri, TomTom, Garmin, FAO, NOAA, USGS | Earthstar Geographics' }),
      'ESRI Topographic Map': tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, detectRetina: true, attribution: 'Esri, USGS | FOEN / Swiss Parks Network, swisstopo, Esri, TomTom, Garmin, FAO, NOAA, USGS | Esri, HERE, Garmin, FAO, NOAA, USGS' }),
      'Open Street Map': tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, detectRetina: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
    },
    overlays: {
      'Add boundaries & names': dynamicMapLayer({url: 'https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer', opacity: 0.6, attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, GIS user community' }),
      'Add population density (1 km)': imageMapLayer({url: 'https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_1km/ImageServer', opacity: 0.4, from: new Date('2020'), to: new Date('2020'), renderingRule: this.renderingRule, minZoom: 7, attribution: 'WorldPop, Esri'}),
      'Add population density (100 m)': imageMapLayer({url: 'https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_100m/ImageServer', opacity: 0.4, from: new Date('2020'), to: new Date('2020'), renderingRule: this.renderingRule, minZoom: 9, attribution: 'WorldPop, Esri'})
    }
  }

  constructor(
    public mapService: MapService,
    public mapPlotsService: MapPlotsService,
    public flexpartService: FlexpartService,
    public store: Store,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    this.routeChanges = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) this.updateDrawingControls();
    });
    this.activePlot$.subscribe(plot => {
      if (!this.map || !plot) return;
      if (plot.type === 'flexpart' && plot.id > this.latestFlexpartPlotId) {
        this.latestFlexpartPlotId = plot.id;
        this.thresholdControlList.forEach(stored => {
          stored.checkboxState = {};
          stored.members = '';
          stored.hiddenConcentrationIds = [];
        });
      }
      this.map.closePopup();
      this.map.off('contextmenu');
      this.currentUnit = null;
      if (this.currentThresholdCtrl) {
        this.map.removeControl(this.currentThresholdCtrl);
        this.currentThresholdCtrl = null;
      }
      if (plot.type == 'stats') {
        const mainPlot = plot.name.split(' - ')[0];
        const stored = this.thresholdControlList.get(mainPlot);
        if (stored) {
          this.currentThresholdCtrl = stored.control;
          this.currentThresholdCtrl.addTo(this.map);
          this.currentUnit = stored.plotUnit;
        }
      }
      if (plot.type == 'flexpart') {
        if (plot.simType == 'ensemble') {
          const stored = this.thresholdControlList.get(plot.name);
          if (stored) {
            this.currentThresholdCtrl = stored.control;
            this.currentThresholdCtrl.addTo(this.map);
          } else {
            this.currentThresholdCtrl = this.createThresholdControl(plot);
            this.thresholdControlList.set(plot.name, {
              control: this.currentThresholdCtrl,
              collapsed: true,
              threshold: null,
              plotUnit: '',
              checkboxState: {}
            });
            this.currentThresholdCtrl.addTo(this.map);
          }
        }
      }
      if (plot.type == 'flexpart' || plot.legendLayer == "percentage agreement") {
        if (!this.currentUnit) {
          this.currentUnit = (/spec\d+_mr/.test(plot.legendLayer)) ? 'ng/m³' : (/D_spec/.test(plot.legendLayer)) ? 'ng/m²' : null;
        }
        this.map.on('contextmenu', this.onRightClick(plot));
      }
    });
  }

  legendPlots(plots: MapPlot[], active: MapPlot): MapPlot[] {
    const parentName = active.type === 'stats' ? active.name.split(' - ')[0] : active.name;
    const concentration = plots.find(p => p.type === 'flexpart' && p.name === parentName);
    const agreement = plots.filter(p => p.visible && p.legendLayer === 'percentage agreement' &&
      p.name.startsWith(`${parentName} - `));
    if (agreement.length) return agreement;
    return concentration ? (concentration.visible ? [concentration] : []) : (active.visible && active.metadata ? [active] : []);
  }

  onMapReady(map: LeafletMap) {
    this.mapService.leafletMap = map;
    this.map = map;
    // Initial map settings at startup
    map.fitBounds(latLngBounds(latLng(57, -15), latLng(43, 33)));
    this.layersControl.baseLayers['ESRI Satellite Map'].addTo(map);
    control.attribution({
      prefix: false, // Remove the default 'Leaflet' prefix
    }).addTo(map);
    // Cursor coordinates
    const coordsControl = new Control({ position: 'bottomleft' });
    coordsControl.onAdd = function () {
      const coordsDiv = DomUtil.create('div', 'leaflet-coords-control');
      coordsDiv.innerText = 'Lat: --, Lon: --';
      return coordsDiv;
    };
    coordsControl.addTo(map);
    map.on('mousemove', (e: LeafletMouseEvent) => {
      const coordsDiv = document.querySelector('.leaflet-coords-control') as HTMLDivElement;
      if (coordsDiv) {
        coordsDiv.innerText = `Lat: ${e.latlng.lat.toFixed(5)}, Lon: ${e.latlng.lng.toFixed(5)}`;
      }
    });
    map.on('mouseout', (e: LeafletMouseEvent) => {
      const coordsDiv = document.querySelector('.leaflet-coords-control') as HTMLDivElement;
      if (coordsDiv) {
        coordsDiv.innerText = 'Lat: --, Lon: --';
      }
    });
    // Inialize scale bar based on screen resolution
    this.getScalebar();
    // If screen resolution changes, get new scale bar
    window.addEventListener('resize', () => {
      this.getScalebar();
    });
    // Setting the zoom options
    map.options.zoomDelta = 1;
    map.options.zoomSnap = 1;
    map.options.wheelPxPerZoomLevel	= 0.1 * window.innerWidth;
    // Name population density layers
    this.popDensityLayer100m = this.layersControl.overlays['Add population density (100 m)'];
    this.popDensityLayer1km = this.layersControl.overlays['Add population density (1 km)'];

    map.pm.addControls({
      position: 'topleft',
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawPolygon: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
      editMode: false,
    });
    this.updateDrawingControls();
    map.pm.enableDraw('Marker', { continueDrawing: false });
    map.pm.disableDraw();
    map.pm.setGlobalOptions({
      markerStyle: {
        icon: icon({
          ...Icon.Default.prototype.options,
          iconUrl: 'assets/marker-icon.png',
          iconRetinaUrl: 'assets/marker-icon-2x.png',
          shadowUrl: 'assets/marker-shadow.png'
        })
      }
    })

    map.on('moveend', async () => {
      if ((map.hasLayer(this.layersControl.overlays['Add population density (1 km)']) && map.getZoom() >= 7) ||
          (map.hasLayer(this.layersControl.overlays['Add population density (100 m)']) && map.getZoom() >= 9)) {   // Only trigger the function if a pop density layer has been clicked
        await updateRenderingRule();
      }
    });

    // Add and Remove Markers
    map.on('pm:create', (e) => {
      if (e.shape == 'Rectangle') {
        const newLayer = e.layer as Rectangle
        const previousLayer = this.mapService.selectionRectangle;
        if (previousLayer) {
          this.store.dispatch(new MapAction.ChangeAreaSelection(this.mapService.rectangleToArea(newLayer)));
          this.mapService.leafletMap.removeLayer(newLayer)
        } else {
          this.mapService.selectionRectangle = newLayer
          this.store.dispatch(new MapAction.ChangeAreaSelection(this.mapService.rectangleToArea(newLayer)));
          this.mapService.selectionRectangle.on('pm:edit', (e: any) => {
            this.store.dispatch(new MapAction.ChangeAreaSelection(this.mapService.rectangleToArea(e.layer as Rectangle)));
          })
        }
      } else if (e.shape == 'Marker') {
        const newLayer = e.layer as Marker
        const previousLayer = this.mapService.selectionMarker;
        if (previousLayer) {
          this.store.dispatch(new MapAction.ChangeMarker(this.mapService.markerToPoint(newLayer)));
          this.mapService.leafletMap.removeLayer(newLayer)
        } else {
          this.mapService.selectionMarker = newLayer
          this.store.dispatch(new MapAction.ChangeMarker(this.mapService.markerToPoint(e.layer as Marker)));
          this.mapService.selectionMarker.on('pm:edit', (e: any) => {
            this.store.dispatch(new MapAction.ChangeMarker(this.mapService.markerToPoint(e.layer as Marker)));
          })
        }
      }
    })

    map.on('pm:remove', (e) => {
      if (e.layer === this.mapService.selectionRectangle) {
        this.store.dispatch(new MapAction.RemoveAreaSelection());
      }
      if (e.layer === this.mapService.selectionMarker) {
        this.store.dispatch(new MapAction.RemoveMarker());
      }
    });

    // Listen to when user selects another layer, to remove the default layer attribution that otherwise stays for other layers
    map.on('baselayerchange', (e) => {
      const layersControl: { [key: string]: TileLayer } = this.layersControl.baseLayers;
      const baseLayerName = Object.keys(layersControl)[0];
      if (baseLayerName && layersControl[baseLayerName]) { // have to check if they exist otherwise Typescript isn't sure the variables exist in the following conditions and returns an error
        const baseLayerAttribution = layersControl[baseLayerName].options.attribution;
        if (e.name !== baseLayerName, baseLayerAttribution) { // when on the default layer, and changing to another one
          const attributionControl = this.map.attributionControl;
          attributionControl.removeAttribution(baseLayerAttribution); // remove the attribution from the default layer
        }
      }
    })

    map.on('overlayadd', async (e) => {
      setTimeout(async () => {  // Ensure Leaflet completes layer changes before updating checkboxes
        if (e.layer === this.popDensityLayer1km) {
          if (map.hasLayer(this.popDensityLayer100m)) {
            map.removeLayer(this.popDensityLayer100m);
            updateCheckboxState('Add population density (100 m)', false);
          }
          await updateRenderingRule();
          // this.popDensityLayer1km.bindPopup((layer: ImageMapLayer) => {
          //   return "Population Density: " + this.popDensityLayer1km.pixel.properties.value + " people/km²";
          // });
        } else if (e.layer === this.popDensityLayer100m) {
          if (map.hasLayer(this.popDensityLayer1km)) {
            map.removeLayer(this.popDensityLayer1km);
            updateCheckboxState('Add population density (1 km)', false);
          }
          await updateRenderingRule();
        }
      }, 50);  // Small delay allows Leaflet to fully process layer toggling
    });
    
    // Helper function to update checkbox state dynamically
    function updateCheckboxState(layerName: string, checked: boolean) {
      const labels = document.querySelectorAll('.leaflet-control-layers label');
      labels.forEach((label) => {
        if (label.textContent?.trim() === layerName) {
          const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
          if (checkbox) checkbox.checked = checked;
        }
      });
    }

    // Simulate a click event on the default layer control button such that Esri Satellite Imagery in the Layers icon appears as clicked by default
    setTimeout(() => {
      const layersControlContainer = document.querySelector('.leaflet-control-layers');
      if (layersControlContainer) {
        const defaultLayerInput = layersControlContainer.querySelectorAll('input[type="radio"]')[0] as HTMLInputElement;
        if (defaultLayerInput) {
          defaultLayerInput.checked = true;
          defaultLayerInput.dispatchEvent(new Event('change'));
        }
      }
    }, 0);

    // Function to update the Pop Density layer's rendering rule dynamically
    const updateRenderingRule = async (): Promise<void> => {
      const bounds = map.getBounds();
      const maxValue = await fetchRegionMax(bounds);
      let renderMax: number;
      if (maxValue > 30000) {
        renderMax = maxValue + 0.1*maxValue;
      } else if (maxValue <= 30000 && maxValue > 5000) {
        renderMax = maxValue + 0.2*maxValue;
      } else {
        renderMax = maxValue + 0.3*maxValue;
      }
      if (renderMax === this.renderingRule.rasterFunctionArguments.Max) {
        this.sameRender = true;
      } else {
        this.sameRender = false;
        this.renderingRule.rasterFunctionArguments.Max = renderMax;
      }
      if (!this.sameRender) {
        if (map.hasLayer(this.layersControl.overlays['Add population density (1 km)'])) {
          this.layersControl.overlays['Add population density (1 km)'].redraw();
        } else if (map.hasLayer(this.layersControl.overlays['Add population density (100 m)'])) {
          this.layersControl.overlays['Add population density (100 m)'].redraw();
        }
      }
    };

    // Function to query World Pop Image Server API for Max value inside bounds
    const fetchRegionMax = async (bounds: L.LatLngBounds): Promise<number> => {
      let statsQueryUrl: string;
      if (map.hasLayer(this.layersControl.overlays['Add population density (100 m)'])) {
        statsQueryUrl = 'https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_100m/ImageServer/computeStatisticsHistograms';
      } else {
        statsQueryUrl = 'https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_1km/ImageServer/computeStatisticsHistograms';
      }
      const params = {
        geometryType: 'esriGeometryEnvelope',
        geometry: JSON.stringify({
          xmin: bounds.getWest(),
          ymin: bounds.getSouth(),
          xmax: bounds.getEast(),
          ymax: bounds.getNorth(),
          spatialReference: { wkid: 4326 }
        }),
        mosaicRule: '',
        renderingRule: '',
        pixelSize: '',
        f: 'json'
      };
      const response = await fetch(`${statsQueryUrl}?${new URLSearchParams(params)}`);
      const data = await response.json();
      return data.statistics[0].max; // Extract the max value
    };
  }

  // Function to create/update scale bar depending on screen resolution
  private getScalebar() {
    if (this.scalebar) {
      this.map.removeControl(this.scalebar);
    }
    const maxWidth = 0.07 * window.innerWidth;
    this.scalebar = new Control.Scale({
      position: 'bottomleft',
      maxWidth: maxWidth,
      metric: true,
      imperial: false,
    }).addTo(this.map);
  }

  private onRightClick = (plot: MapPlot) => async (e: LeafletMouseEvent) => {
    if (this.mapService.animationActive) return;
    const { lat, lng } = e.latlng;
    const georaster = plot.data;
    const column = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
    const row = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);
    if (column >= 0 && column < georaster.width && row >= 0 && row < georaster.height) {
      //const value = await geoblaze.identify(plot.data, [lng, lat]); // Ideally using geoblaze, but ignores col = 0 and row = 0
      const value = await georaster.values.map((val: number[][]) => val[row][column]);
      if (value != null && Number(value) != 0) {
        const height = plot.selectedParams?.height ? `${plot.selectedParams['height'].value} m` : '- (surface)';
        const valueLine = plot.type === 'stats' ? `<b>Members over threshold:</b> ${Number(value).toFixed(0)} %` : `<b>Value:</b> ${Number(value).toFixed(2)} ${this.currentUnit}`;
        new Popup()
          .setLatLng([lat, lng])
          .setContent(
            `<b>Name:</b> ${plot.name}<br>
            <b>Substance:</b> ${plot.selectedParams!['substance'].value}<br>
            <b>Time:</b> ${plot.selectedParams!['Ti'].value}<br>
            <b>Coordinates:</b> (${lat.toFixed(5)}, ${lng.toFixed(5)})<br>
            <b>Height:</b> ${height}<br>
            ${valueLine}`
          )
          .openOn(this.map);
      }
    }
  };

  private createThresholdControl(plot: MapPlot, options: ThresholdControlOptions = {}): Control {
    const ThresholdControl = Control.extend({
      options: {
        collapsed: true,
        checkboxState: {}
      },

      onAdd: (map: LeafletMap) => {
        const storedCtrl = this.thresholdControlList.get(plot.name);
        const container = DomUtil.create('div', 'threshold-control');
        if (storedCtrl) {
          if (/spec\d+_mr/.test(plot.legendLayer)) {
            storedCtrl.plotUnit = 'ng/m³';
          } else if (/D_spec/.test(plot.legendLayer)) {
            storedCtrl.plotUnit = 'ng/m²';
          }
        }

        // Input field
        const inputWrapper = DomUtil.create('div', 'threshold-input-wrapper', container);
        const label = DomUtil.create('label', 'threshold-label', inputWrapper);
        label.innerText = 'Threshold value:';
        const input = DomUtil.create('input', 'threshold-input', inputWrapper) as HTMLInputElement;
        input.type = 'text';
        input.inputMode = 'decimal';
        if (storedCtrl && storedCtrl.threshold) {
          input.value = storedCtrl.threshold.toString();
        }

        // "Calculate statistics" button
        const calculateBtn = DomUtil.create('button', 'calculate-btn', container) as HTMLButtonElement;
        const statusWrapper = DomUtil.create('div', 'status-wrapper', container);
        calculateBtn.innerText = 'Calculate statistics';
        calculateBtn.disabled = true;

        // Toggle statistics plots button
        const optionsWrapper = DomUtil.create('div', '', container);
        const toggleBtn = DomUtil.create('button', 'toggle-checkboxes-btn', container) as HTMLButtonElement;
        let isVisible: boolean;
        if (storedCtrl) {
          optionsWrapper.style.display = storedCtrl.collapsed ? 'none' : 'block';
          toggleBtn.innerText = storedCtrl.collapsed ? '▼ Show results' : '▲ Hide results';
          isVisible = storedCtrl.collapsed ? false : true;
        }
        toggleBtn.addEventListener('click', () => {
          isVisible = !isVisible;
          if (storedCtrl) {
            storedCtrl.collapsed = !isVisible;
          }
          optionsWrapper.style.display = isVisible ? 'block' : 'none';
          toggleBtn.innerText = isVisible ? '▲ Hide results' : '▼ Show results';
        });

        // Logic behind "Calculate statistics" button
        input.addEventListener('input', () => {
          const value = Number(input.value);
          const valid = Number.isFinite(value) && value > 0;
          calculateBtn.disabled = !valid;

        });
        input.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Enter' && !calculateBtn.disabled) {
            calculateBtn.click();
          }
        });
        const agreementLabel = DomUtil.create('label', 'checkbox-wrapper', optionsWrapper);
        const agreement = DomUtil.create('input', '', agreementLabel) as HTMLInputElement;
        agreement.type = 'checkbox';
        agreement.checked = !!storedCtrl?.checkboxState['percentage agreement'];
        agreementLabel.appendChild(document.createTextNode('Percentage agreement'));
        const memberLabel = DomUtil.create('label', 'member-label', optionsWrapper);
        memberLabel.innerText = 'Member numbers:';
        const members = DomUtil.create('input', 'member-input', memberLabel) as HTMLInputElement;
        members.type = 'text';
        members.placeholder = 'e.g. 1, 12, 50 or all';
        members.value = storedCtrl?.members || '';
        const memberStatus = DomUtil.create('div', 'member-status', optionsWrapper);
        memberStatus.setAttribute('role', 'status');
        const updateVisibility = (labels: string[], visible: boolean) => {
          const plots = this.store.selectSnapshot(MapPlotState.mapPlots);
          const actions = plots.filter(p => labels.some(label =>
            p.name === `${plot.name} - ${label} (${storedCtrl?.threshold} ${storedCtrl?.plotUnit})`
          )).map(p => visible ? new MapPlotAction.Show(p.id) : new MapPlotAction.Hide(p.id));
          if (actions.length) this.store.dispatch(actions);
        };
        const toggleConcentration = (showAgreement: boolean) => {
          if (!storedCtrl) return;
          const plots = this.store.selectSnapshot(MapPlotState.mapPlots);
          if (showAgreement) {
            storedCtrl.hiddenConcentrationIds = plots.filter(p => p.type === 'flexpart' && p.visible).map(p => p.id);
            const actions = storedCtrl.hiddenConcentrationIds.map(id => new MapPlotAction.Hide(id));
            if (actions.length) this.store.dispatch(actions);
          } else {
            const actions = (storedCtrl.hiddenConcentrationIds || []).map(id => new MapPlotAction.Show(id));
            storedCtrl.hiddenConcentrationIds = [];
            if (actions.length) this.store.dispatch(actions);
          }
        };
        agreement.addEventListener('change', () => {
          if (storedCtrl) storedCtrl.checkboxState['percentage agreement'] = agreement.checked;
          toggleConcentration(agreement.checked);
          updateVisibility(['percentage agreement'], agreement.checked);
        });
        members.addEventListener('input', () => {
          const value = members.value.trim();
          const allMembers = value.toLowerCase() === 'all';
          const tokens = value ? value.split(',').map(token => token.trim()) : [];
          const plots = this.store.selectSnapshot(MapPlotState.mapPlots);
          const available = plots.filter(p => p.type === 'stats' && /^member \d+$/.test(p.legendLayer) &&
            p.name === `${plot.name} - ${p.legendLayer} (${storedCtrl?.threshold} ${storedCtrl?.plotUnit})`
          ).map(p => Number(p.legendLayer.slice('member '.length)));
          const selected = allMembers ? [...new Set(available)] : [...new Set(tokens.map(Number))];
          const valid = allMembers || (tokens.every(token => /^\d+$/.test(token)) &&
            selected.every(number => available.includes(number)));
          const error = 'Enter member numbers separated by commas, or all.';
          members.setCustomValidity(valid ? '' : error);
          memberStatus.innerText = valid ? '' : error;
          if (!valid || !storedCtrl) return;
          storedCtrl.members = members.value;
          const previous = Object.keys(storedCtrl.checkboxState).filter(label => label.startsWith('member '));
          const next = selected.map(number => `member ${number}`);
          updateVisibility(previous.filter(label => !next.includes(label)), false);
          updateVisibility(next, true);
          previous.forEach(label => delete storedCtrl.checkboxState[label]);
          next.forEach(label => storedCtrl.checkboxState[label] = true);
        });
        agreement.disabled = members.disabled = !storedCtrl?.ready;
        calculateBtn.addEventListener('click', () => {
          const threshold = Number(input.value);
          input.disabled = true;
          calculateBtn.disabled = true;
          agreement.disabled = members.disabled = true;
          toggleConcentration(false);
          updateVisibility(Object.keys(storedCtrl?.checkboxState || {}), false);
          agreement.checked = false;
          members.value = '';
          memberStatus.innerText = '';
          if (storedCtrl) {
            storedCtrl.checkboxState = {};
            storedCtrl.members = '';
            storedCtrl.ready = false;
            storedCtrl.threshold = threshold;
          }
          statusWrapper.innerHTML = '<div class="spinner"></div>';
          const dimsIndices: { [key: string]: number } = {};
          ['Ti', 'height'].forEach(key => {
            const entry = plot.selectedParams![key];
            if (entry) dimsIndices[key] = entry.index;
          });
          const failed = () => {
            statusWrapper.innerText = 'Unable to calculate statistics. Please try again.';
            input.disabled = false;
            calculateBtn.disabled = false;
          };
          this.flexpartService.getEnsembleStats(plot.fpOutputId!, plot.legendLayer, dimsIndices, threshold).subscribe({
            next: result => {
              this.store.dispatch(new MapPlotAction.AddStatsTiff(result, 'stats',
                [`percentage agreement (${threshold} ${storedCtrl?.plotUnit})`], plot.selectedParams!, plot.name)).subscribe({
                complete: () => {
                  statusWrapper.innerText = 'Done!';
                  input.disabled = false;
                  if (storedCtrl) storedCtrl.ready = true;
                  agreement.disabled = members.disabled = false;
                },
                error: failed
              });
            },
            error: failed
          });
        });

        DomEvent.disableClickPropagation(container);
        DomEvent.disableScrollPropagation(container);
        return container;
      },

      onRemove: () => {}
    });

    return new ThresholdControl({position: 'topright'});
  }

}