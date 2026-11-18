import { MapExportControl } from './map-export-control';

describe('Map export composition', () => {
  let map: HTMLDivElement;
  let paneRoot: HTMLDivElement;
  let exporter: MapExportControl;

  beforeEach(() => {
    map = document.createElement('div');
    map.style.cssText = 'position:fixed;left:20px;top:20px;width:200px;height:120px;overflow:hidden;background:white';
    paneRoot = document.createElement('div');
    paneRoot.className = 'leaflet-map-pane';
    map.appendChild(paneRoot);
    document.body.appendChild(map);
    exporter = new MapExportControl();
    exporter.onAdd({getContainer: () => map} as any);
  });

  afterEach(() => { exporter.onRemove(); map.remove(); });

  function layer(z: number, color: string): HTMLCanvasElement {
    const pane = document.createElement('div');
    pane.className = 'leaflet-pane';
    pane.style.cssText = `position:absolute;left:0;top:0;z-index:${z}`;
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 120;
    canvas.style.cssText = 'width:200px;height:120px';
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 200, 120);
    pane.appendChild(canvas); paneRoot.appendChild(pane);
    return canvas;
  }

  async function capture(): Promise<HTMLCanvasElement> { return (exporter as any).render(); }
  function pixel(canvas: HTMLCanvasElement, x: number, y: number): number[] {
    return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
  }

  it('exports at twice displayed resolution without including earlier map captures or controls', async () => {
    layer(200, 'navy');
    const iframe = document.createElement('iframe');
    iframe.className = 'html2canvas-container';
    iframe.style.cssText = 'position:absolute;left:0;top:0;width:200px;height:120px;background:magenta';
    map.appendChild(iframe);
    const controls = document.createElement('div');
    controls.className = 'leaflet-control-zoom';
    controls.style.cssText = 'position:absolute;inset:0;background:red';
    map.appendChild(controls);
    const result = await capture();
    expect(result.width).toBe(Math.round(200 * Math.max(2, window.devicePixelRatio) / 2) * 2);
    expect(result.height).toBe(Math.round(120 * Math.max(2, window.devicePixelRatio) / 2) * 2);
    expect(pixel(result, 100, 100)).toEqual([0, 0, 128, 255]);
    // A recording surface must receive pixels without inheriting the render scale.
    expect(result.getContext('2d')!.getTransform().a).toBe(1);
  });

  it('respects Leaflet pane order and overlay opacity regardless of DOM order', async () => {
    const overlay = layer(450, 'red');
    overlay.parentElement!.style.opacity = '0.5';
    layer(200, 'blue');
    const result = await capture();
    const rgba = pixel(result, 100, 100);
    expect(rgba[0]).toBeCloseTo(128, -1);
    expect(rgba[1]).toBe(0);
    expect(rgba[2]).toBeCloseTo(127, -1);
  });

  it('applies panned layer positions once and clips them to the map bounds', async () => {
    layer(200, 'blue');
    const overlay = layer(450, 'red');
    overlay.style.transform = 'translate(-100px, 0)';
    const result = await capture();
    expect(pixel(result, 40, 40)).toEqual([255, 0, 0, 255]);
    expect(pixel(result, result.width - 40, 40)).toEqual([0, 0, 255, 255]);
  });
  it('keeps a high-z raster above basemap tiles with a newer zoom container', async () => {
    const raster = layer(200, 'red');
    const pane = raster.parentElement!;
    const group = (z: number, zoom: number, canvas: HTMLCanvasElement) => {
      const container = document.createElement('div');
      container.style.cssText = `position:absolute;left:0;top:0;z-index:${z}`;
      const tiles = document.createElement('div');
      tiles.className = 'leaflet-tile-container';
      tiles.style.cssText = `position:absolute;left:0;top:0;z-index:${zoom}`;
      tiles.appendChild(canvas); container.appendChild(tiles); pane.appendChild(container);
    };
    group(1000, 18, raster);
    const basemap = document.createElement('canvas');
    basemap.width = 200; basemap.height = 120;
    basemap.getContext('2d')!.fillStyle = 'blue';
    basemap.getContext('2d')!.fillRect(0, 0, 200, 120);
    group(1, 19, basemap);
    const result = await capture();
    expect(pixel(result, 100, 100)).toEqual([255, 0, 0, 255]);
  });

  it('retains spatial pixels if the live canvas is cleared while Save As is open', async () => {
    const raster = layer(200, 'red');
    const pending = capture();
    raster.getContext('2d')!.clearRect(0, 0, raster.width, raster.height);
    const result = await pending;
    expect(pixel(result, 100, 100)).toEqual([255, 0, 0, 255]);
  });

  it('draws a padded partial raster tile at its visible content position', async () => {
    layer(200, 'blue');
    const raster = layer(450, 'red');
    raster.width = 40; raster.height = 40;
    raster.style.cssText = 'width:40px;height:40px;padding-left:100px;padding-top:60px;box-sizing:content-box';
    const context = raster.getContext('2d')!;
    context.fillStyle = 'red'; context.fillRect(0, 0, 40, 40);
    const result = await capture();
    const scale = result.width / 200;
    expect(pixel(result, 110 * scale, 70 * scale)).toEqual([255, 0, 0, 255]);
    expect(pixel(result, 30 * scale, 30 * scale)).toEqual([0, 0, 255, 255]);
    expect(pixel(result, 160 * scale, 70 * scale)).toEqual([0, 0, 255, 255]);
  });

  it('anchors attribution at the bottom edge and keeps scale labels inside the export', () => {
    const attribution=document.createElement('div');attribution.className='leaflet-control-attribution';
    attribution.textContent='Esri, USGS | Earthstar Geographics | OpenStreetMap contributors';map.appendChild(attribution);
    const scale=document.createElement('div');scale.className='leaflet-control-scale-line';
    scale.style.width='80px';scale.textContent='100 km';map.appendChild(scale);
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;
    const context=canvas.getContext('2d')!;
    const text=spyOn(context,'fillText').and.callThrough();
    const boxes=spyOn(context,'fillRect').and.callThrough();
    (exporter as any).mapAnnotations(context,800,400,true);
    expect(boxes.calls.allArgs().some(args=>args[1]+args[3]===400)).toBe(true);
    expect(text.calls.allArgs().some(args=>String(args[0]).includes('Esri'))).toBe(true);
    expect(text.calls.allArgs().some(args=>args[0]==='100 km')).toBe(true);
    for (const args of text.calls.allArgs()) {
      expect(args[1]).toBeGreaterThanOrEqual(8);
      expect(args[2]).toBeGreaterThanOrEqual(0);
      expect(args[2]+13).toBeLessThanOrEqual(400);
    }
  });

  it('positions SVG location circles once when the renderer has a pan transform', async () => {
    layer(200, 'blue');
    const pane=document.createElement('div');pane.className='leaflet-pane';
    pane.style.cssText='position:absolute;left:0;top:0;z-index:400';paneRoot.appendChild(pane);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','200');svg.setAttribute('height','120');svg.setAttribute('viewBox','20 10 200 120');
    svg.style.cssText='position:absolute;left:0;top:0;transform:translate(30px,20px)';
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx','100');circle.setAttribute('cy','80');circle.setAttribute('r','5');circle.setAttribute('fill','white');
    svg.appendChild(circle);pane.appendChild(svg);
    const result=await capture();const scale=result.width/200;
    expect(pixel(result,110*scale,90*scale)).toEqual([255,255,255,255]);
    expect(pixel(result,140*scale,110*scale)).toEqual([0,0,255,255]);
  });

  it('removes histogram headers and pin hints from the saved image without leaving space', async () => {
    layer(200,'blue');
    const histogram=document.createElement('app-arrival-histogram');
    histogram.style.cssText='display:block;position:absolute;left:0;top:0;width:160px';
    histogram.innerHTML='<section class="arrival-histogram" style="background:white"><header style="height:30px;background:red">Duration above threshold · Unpin</header><div class="histogram-body" style="background:lime"><div style="height:40px"></div></div><div class="footer" style="height:10px;background:red">Click map to pin</div></section>';
    map.appendChild(histogram);
    const result=await capture();const scale=result.width/200;
    expect(pixel(result,15*scale,15*scale)).toEqual([0,255,0,255]);
    expect(pixel(result,15*scale,60*scale)).toEqual([0,0,255,255]);
    expect(histogram.querySelector('header')).not.toBeNull();
    expect(histogram.querySelector('.footer')).not.toBeNull();
  });

  it('starts downloads from an attached link with a matching container type and filename', () => {
    jasmine.clock().install();
    try {
      const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:test-export');
      const revoke = spyOn(URL, 'revokeObjectURL');
      let anchor: HTMLAnchorElement | undefined;
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function(this: HTMLAnchorElement) {
        anchor = this;
        expect(this.isConnected).toBe(true);
        expect(this.download).toMatch(/\.webm$/);
      });
      (exporter as any).download(new Blob(['video'], {type: 'video/webm;codecs=vp9'}), 'webm');
      expect((create.calls.mostRecent().args[0] as Blob).type).toBe('video/webm');
      expect(anchor!.isConnected).toBe(true);
      jasmine.clock().tick(1000);
      expect(anchor!.isConnected).toBe(false);
      jasmine.clock().tick(60000);
      expect(revoke).not.toHaveBeenCalled();
      jasmine.clock().tick(10 * 60 * 1000);
      expect(revoke).toHaveBeenCalledWith('blob:test-export');
    } finally { jasmine.clock().uninstall(); }
  });

});
