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
