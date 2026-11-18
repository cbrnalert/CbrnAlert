import type { MapExportHeading } from './map-export-heading';
import { chooseExportFile, exportFilename, ExportFileHandle, writeExportFile } from './export-file';
import { Control, DomEvent, DomUtil, Map as LeafletMap } from 'leaflet';

// Keep scales, attribution, legends, chart traces and the animation timestamp.
const excluded = [
  '.leaflet-control-zoom', '.leaflet-control-layers', '.leaflet-coords-control',
  '.map-opacity-control', '.map-plot-actions', '.map-export-control', '.leaflet-pm-toolbar',
  '.panel-actions', '.figure-actions', '.coordinate-controls', '.location-controls',
  '.resize-handle', '.modebar', '.animation-controls button', '.animation-controls .speed'
].join(',');

export class MapExportControl extends Control {
  private mapElement!: HTMLElement;
  private imageButton!: HTMLButtonElement;
  private videoButton!: HTMLButtonElement;
  private status!: HTMLElement;
  private busy = false;
  private disposed = false;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private recording = false;
  private videoDestination?: Promise<ExportFileHandle | null | undefined>;
  private session = 0;
  private capturing?: Promise<HTMLCanvasElement>;
  private readonly exportImages = new Map<string, Promise<HTMLImageElement>>();

  constructor(private readonly heading?: () => MapExportHeading | undefined) { super({position: 'topleft'}); }

  onAdd(map: LeafletMap): HTMLElement {
    this.mapElement = map.getContainer();
    const container = DomUtil.create('div', 'map-export-control leaflet-bar');
    const button = (label: string, glyph: string, action: () => void) => {
      const element = DomUtil.create('button', '', container) as HTMLButtonElement;
      element.type = 'button'; element.title = label; element.setAttribute('aria-label', label);
      const icon = DomUtil.create('span', 'material-icons', element);
      icon.textContent = glyph; icon.setAttribute('aria-hidden', 'true');
      element.addEventListener('click', action);
      return element;
    };
    this.imageButton = button('Save map image', 'photo_camera', () => void this.saveImage());
    this.videoButton = button('Start video recording', 'videocam', () => {
      if (this.recording) this.stopRecording(true); else void this.startVideo();
    });
    this.status = DomUtil.create('span', 'map-export-status', container);
    this.status.setAttribute('role', 'status');
    DomEvent.disableClickPropagation(container);
    DomEvent.disableScrollPropagation(container);
    DomEvent.on(container, 'keydown', DomEvent.stopPropagation);
    return container;
  }

  onRemove(): void {
    this.disposed = true;
    this.stopRecording();
  }

  private message(text: string): void { this.status.textContent = text; }

  private async capture(includeHeading = false): Promise<HTMLCanvasElement> {
    if (this.capturing) await this.capturing;
    const pending = this.render(includeHeading);
    this.capturing = pending;
    try { return await pending; } finally { if (this.capturing === pending) this.capturing = undefined; }
  }

  private image(url: string): Promise<HTMLImageElement> {
    let pending = this.exportImages.get(url);
    if (!pending) {
      pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => { this.exportImages.delete(url); reject(new Error('Map image could not be loaded')); };
        image.src = url;
      });
      this.exportImages.set(url, pending);
    }
    return pending;
  }

  private opacity(element: Element): number {
    let opacity = 1;
    for (let node: Element | null = element; node && node !== this.mapElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return 0;
      opacity *= Number(style.opacity);
    }
    return opacity;
  }

  private contentBounds(element: HTMLElement): DOMRect {
    const bounds = element.getBoundingClientRect();
    if (!(element instanceof HTMLCanvasElement || element instanceof HTMLImageElement)) return bounds;
    // GeoRasterLayer pads partial tiles to their full Leaflet tile size. Only
    // the content box contains pixels; stretching it across the padding moves
    // the plume and can put small spatial plots outside the exported view.
    const style = getComputedStyle(element);
    const number = (value: string) => parseFloat(value) || 0;
    const left = number(style.paddingLeft) + number(style.borderLeftWidth);
    const right = number(style.paddingRight) + number(style.borderRightWidth);
    const top = number(style.paddingTop) + number(style.borderTopWidth);
    const bottom = number(style.paddingBottom) + number(style.borderBottomWidth);
    const scaleX = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight ? bounds.height / element.offsetHeight : 1;
    return new DOMRect(bounds.left + left * scaleX, bounds.top + top * scaleY,
      Math.max(0, bounds.width - (left + right) * scaleX), Math.max(0, bounds.height - (top + bottom) * scaleY));
  }

  private mapAnnotations(context: CanvasRenderingContext2D, width: number, height: number, paint = false): number {
    const attribution = this.mapElement.querySelector('.leaflet-control-attribution')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const scale = this.mapElement.querySelector<HTMLElement>('.leaflet-control-scale-line');
    const maximumWidth = Math.max(40, Math.min(900, width - 180));
    context.save();
    context.font = '10px Arial, sans-serif';
    context.textBaseline = 'top';
    const lines: string[] = [];
    let line = '';
    for (const word of attribution.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > maximumWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    const footerHeight = Math.max(scale ? 36 : 0, lines.length ? lines.length * 13 + 20 : 0);
    if (paint) {
      if (lines.length) {
        const boxWidth = Math.min(width - 16, Math.max(...lines.map(text => context.measureText(text).width)) + 12);
        const boxHeight = lines.length * 13 + 10;
        const x = width - boxWidth - 8, y = height - boxHeight;
        context.fillStyle = 'rgba(255,255,255,0.88)'; context.fillRect(x, y, boxWidth, boxHeight);
        context.fillStyle = '#333';
        lines.forEach((text, index) => context.fillText(text, x + 6, y + 5 + index * 13));
      }
      if (scale) {
        // Keep the actual Leaflet bar length: it is calibrated for this map zoom.
        const barWidth = scale.getBoundingClientRect().width;
        const label = scale.textContent?.trim() || '';
        context.font = '11px Arial, sans-serif';
        const boxWidth = Math.max(barWidth, context.measureText(label).width) + 12;
        const x = 8, y = height - 36;
        context.fillStyle = 'rgba(255,255,255,0.88)'; context.fillRect(x, y, boxWidth, 28);
        context.fillStyle = '#333'; context.fillText(label, x + 6, y + 3);
        context.strokeStyle = '#333'; context.lineWidth = 2;
        context.beginPath(); context.moveTo(x + 6, y + 18); context.lineTo(x + 6, y + 23);
        context.lineTo(x + 6 + barWidth, y + 23); context.lineTo(x + 6 + barWidth, y + 18); context.stroke();
      }
    }
    context.restore();
    return footerHeight;
  }

  private paintHeading(context: CanvasRenderingContext2D, width: number, heading: MapExportHeading): void {
    context.save();
    const maximum = Math.max(80, width - 40);
    const rows: {text:string;font:string}[] = [];
    for (const [text,font] of [[heading.title,'bold 14px Arial, sans-serif'],[heading.detail,'12px Arial, sans-serif']]) {
      if (!text) continue;
      context.font = font;
      let line = '';
      for (const word of text.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && context.measureText(next).width > maximum) { rows.push({text:line,font}); line = word; }
        else line = next;
      }
      if (line) rows.push({text:line,font});
    }
    context.textAlign = 'center'; context.textBaseline = 'top';
    context.fillStyle = '#fff'; context.strokeStyle = '#000';
    context.lineWidth = 3; context.lineJoin = 'round';
    rows.forEach((row,index)=>{
      context.font=row.font;
      const y = 15 + index*18;
      context.strokeText(row.text,width/2,y);
      context.fillText(row.text,width/2,y);
    });
    context.restore();
  }

  private async render(includeHeading = false): Promise<HTMLCanvasElement> {
    const heading = includeHeading ? this.heading?.() : undefined;
    const map = this.mapElement.getBoundingClientRect();
    // Render at twice the displayed size (up to 4K), with even encoder dimensions.
    const scale = Math.min(Math.max(2, window.devicePixelRatio || 1), 3840 / Math.max(map.width, map.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(map.width * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(map.height * scale / 2) * 2);
    const context = canvas.getContext('2d')!;
    context.scale(canvas.width / map.width, canvas.height / map.height);
    context.fillStyle = getComputedStyle(this.mapElement).backgroundColor || '#ddd';
    context.fillRect(0, 0, map.width, map.height);

    // Composite Leaflet's real tile/image/canvas layers exactly once. Repeated
    // whole-document captures can include an earlier html2canvas iframe/map.
    // Viewport rectangles already include Leaflet's pan and zoom transforms.
    const panes = Array.from(this.mapElement.querySelectorAll<HTMLElement>('.leaflet-map-pane > .leaflet-pane'))
      .sort((a, b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex));
    const layers: {source: CanvasImageSource | Promise<HTMLImageElement>; bounds: DOMRect; opacity: number}[] = [];
    for (const pane of panes) {
      const elements = Array.from(pane.querySelectorAll<HTMLElement>('img, canvas, svg'))
        .filter(element => !element.parentElement?.closest('svg'))
        .sort((a, b) => {
          const chain = (element: Element): number[] => {
            const indices: number[] = [];
            for (let node: Element | null = element; node && node !== pane; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (style.zIndex !== 'auto' || style.transform !== 'none' || Number(style.opacity) < 1) {
                indices.unshift(Number(style.zIndex) || 0);
              }
            }
            return indices;
          };
          // A raster layer's z-index outranks every zoom container inside the
          // basemap layer. Sorting only zoom containers paints basemap tiles
          // over spatial results after a pan/zoom.
          const left = chain(a), right = chain(b);
          for (let index = 0; index < Math.max(left.length, right.length); index++) {
            const difference = (left[index] || 0) - (right[index] || 0);
            if (difference) return difference;
          }
          return 0;
        });
      for (const element of elements) {
        const bounds = this.contentBounds(element), opacity = this.opacity(element);
        if (!opacity || !bounds.width || !bounds.height || bounds.right < map.left || bounds.left > map.right || bounds.bottom < map.top || bounds.top > map.bottom) continue;
        let source: CanvasImageSource | Promise<HTMLImageElement>;
        if (element instanceof HTMLCanvasElement) {
          if (!element.width || !element.height) continue;
          const copy = document.createElement('canvas');
          copy.width = element.width; copy.height = element.height;
          copy.getContext('2d')!.drawImage(element, 0, 0);
          source = copy;
        } else if (element instanceof HTMLImageElement) {
          if (!element.complete || !element.naturalWidth) continue;
          source = this.image(element.currentSrc || element.src);
        } else {
          const clone = element.cloneNode(true) as SVGSVGElement;
          // bounds already includes Leaflet's SVG pan/zoom translation. Applying
          // that root CSS transform inside the SVG image shifts markers twice.
          clone.style.transform = 'none';
          clone.style.position = 'static';
          clone.style.left = 'auto'; clone.style.top = 'auto'; clone.style.margin = '0';
          clone.style.opacity = '1'; // Root opacity is applied by the compositor.
          const svg = new XMLSerializer().serializeToString(clone);
          // SVGs change each frame; do not retain their data URLs in the tile cache.
          source = new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          });
        }
        layers.push({source, bounds, opacity});
      }
    }
    const {default: html2canvas} = await import('html2canvas');
    // Only small UI overlays are captured as DOM. No map, iframe or recording
    // canvas is ever included in these snapshots.
    const overlays = Array.from(this.mapElement.querySelectorAll<HTMLElement>(
      '.map-legends, .animation-colorbar, .flexpart-animation-dock, app-arrival-histogram, .leaflet-popup'));
    const staticPanel = document.querySelector<HTMLElement>('.ensemble-panel:not(.minimized)');
    if (staticPanel?.querySelector('.static-chart .main-svg')) overlays.push(staticPanel);
    // Start every clone before awaiting resources, keeping chart timestamps
    // aligned with the raster/canvas layers snapshotted above.
    const snapshots = overlays.map(async overlay => {
      if (overlay.matches('app-arrival-histogram') && overlay.querySelector<HTMLElement>('.histogram-body')?.hidden) return undefined;
      const bounds = overlay.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !this.opacity(overlay)) return undefined;
      const snapshot = await html2canvas(overlay, {
        useCORS: true, allowTaint: false, logging: false, scale, backgroundColor: null, removeContainer: true,
        ignoreElements: element => element.tagName === 'IFRAME' || element.classList.contains('html2canvas-container'),
        onclone: (_document, target) => {
          target.querySelectorAll<HTMLElement>(excluded).forEach(element => element.style.opacity = '0');
          // Normalize the captured root, rather than moving a second copy of it.
          Object.assign(target.style, {transform: 'none', position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`,
            bottom: 'auto', right: 'auto', width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0', boxShadow: 'none'});
          if (overlay.matches('app-arrival-histogram')) {
            target.querySelectorAll('header, .footer').forEach(element => element.remove());
            target.style.height = 'auto';
            target.querySelectorAll<HTMLElement>('.arrival-histogram, .histogram-body').forEach(element => {
              element.style.height = 'auto'; element.style.minHeight = '0';
            });
          }
        }
      });
      const exportedBounds = overlay.matches('app-arrival-histogram')
        ? new DOMRect(bounds.left, bounds.top, snapshot.width / scale, snapshot.height / scale) : bounds;
      return {snapshot, bounds: exportedBounds, overlay};
    });
    const [sources, captures] = await Promise.all([
      Promise.all(layers.map(layer => layer.source)), Promise.all(snapshots)
    ]);
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index], source = sources[index];
      context.globalAlpha = layer.opacity;
      context.drawImage(source, layer.bounds.left - map.left, layer.bounds.top - map.top, layer.bounds.width, layer.bounds.height);
    }
    context.globalAlpha = 1;

    const footerHeight = this.mapAnnotations(context, map.width, map.height);
    for (const result of captures) {
      if (!result) continue;
      const {snapshot, bounds} = result;
      const ratio = Math.min(1, map.width / bounds.width, map.height / bounds.height);
      const width = bounds.width * ratio, height = bounds.height * ratio;
      const x = Math.max(0, Math.min(map.width - width, bounds.left - map.left));
      const bottomInset = result.overlay.matches('.flexpart-animation-dock, .ensemble-panel') ? footerHeight : 0;
      const y = Math.max(0, Math.min(map.height - bottomInset - height, bounds.top - map.top));
      context.drawImage(snapshot, x, y, width, height);
    }
    this.mapAnnotations(context, map.width, map.height, true);
    if (heading) this.paintHeading(context, map.width, heading);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  private download(blob: Blob, extension: string): void {
    if (this.disposed) return;
    // Use a standard container MIME type and an attached download link. Some
    // browsers handle detached anchors or codec parameters inconsistently.
    const mime = extension === 'png' ? 'image/png' : extension === 'mp4' ? 'video/mp4' : 'video/webm';
    const file = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename(extension);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    // Allow the browser to adopt the download before removing its anchor, and
    // retain large video blobs while a Save As dialog or download is pending.
    setTimeout(() => link.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  }

  private async saveBlob(blob: Blob, extension: string, destination?: ExportFileHandle | null): Promise<void> {
    if (destination === null || this.disposed) return;
    if (destination) await writeExportFile(destination, blob);
    else this.download(blob, extension);
  }

  private async saveImage(): Promise<void> {
    if (this.busy || this.recording) return;
    this.busy = true; this.imageButton.disabled = this.videoButton.disabled = true;
    this.message('Saving image…');
    try {
      // Copy spatial canvases before Save As can hide/repaint the browser tab.
      // Starting this capture is synchronous up to the small-overlay import.
      const capture = this.capture(true);
      capture.catch(() => undefined);
      const destination = await chooseExportFile('png', 'image/png');
      if (destination === null) { await capture.catch(() => undefined); this.message(''); return; }
      const canvas = await capture;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('Empty image')), 'image/png'));
      await this.saveBlob(blob, 'png', destination); this.message('');
    } catch { this.message('Image could not be saved. Check map tiles and try again.'); }
    finally { this.busy = false; this.imageButton.disabled = this.videoButton.disabled = false; }
  }

  private async startVideo(): Promise<void> {
    if (this.busy || this.disposed) return;
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      this.message('Video recording is unavailable in this browser.'); return;
    }
    this.busy = true;
    const session = ++this.session;
    this.videoDestination = undefined;
    this.imageButton.disabled = this.videoButton.disabled = true;
    this.message('Starting recording…');
    try {
      const firstFrame = await this.capture();
      if (this.disposed || session !== this.session) {
        this.imageButton.disabled = this.videoButton.disabled = false;
        if (this.status.textContent === 'Starting recording…') this.message('');
        return;
      }
      // Keep the recording surface separate from every immutable snapshot.
      const canvas = document.createElement('canvas');
      canvas.width = firstFrame.width; canvas.height = firstFrame.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(firstFrame, 0, 0);
      this.stream = canvas.captureStream(10);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('No supported video format');
      const recorder = this.recorder = new MediaRecorder(this.stream, {mimeType,
        videoBitsPerSecond: Math.max(12_000_000, Math.min(32_000_000, canvas.width * canvas.height * 6))});
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        this.busy = true; this.videoButton.disabled = true;
        this.message('Saving video…');
        try {
          if (chunks.length) {
            const type = recorder.mimeType.split(';')[0];
            const destination = await this.videoDestination;
            await this.saveBlob(new Blob(chunks, {type}), type === 'video/mp4' ? 'mp4' : 'webm', destination);
          }
          this.message('');
        } catch { this.message('Video could not be saved. Try another folder.'); }
        finally { this.finishVideo(); }
      };
      recorder.onerror = () => { this.stopRecording(); this.message('Video recording failed. Please try again.'); };
      recorder.start(1000);
      this.recording = true; this.busy = false; this.videoButton.disabled = false;
      this.videoButton.classList.add('recording');
      this.videoButton.title = 'Stop recording and save video';
      this.videoButton.setAttribute('aria-label', this.videoButton.title);
      this.videoButton.querySelector('span')!.textContent = 'stop';
      this.message('Recording');
      while (session === this.session && !this.disposed) {
        const frame = await this.capture();
        if (session !== this.session || this.disposed) break;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch {
      if (session === this.session) {
        this.stopRecording();
        if (!this.recorder) this.finishVideo();
        this.message('Video could not be saved. Check map tiles and try again.');
      }
    } finally { if (session === this.session) this.busy = false; }
  }

  stopRecording(chooseDestination = false): void {
    if (chooseDestination && this.recorder && this.recorder.state !== 'inactive') {
      const type = this.recorder.mimeType.split(';')[0];
      this.videoDestination = chooseExportFile(type === 'video/mp4' ? 'mp4' : 'webm', type);
      // Attach a handler immediately while MediaRecorder finishes its last chunk.
      this.videoDestination.catch(() => undefined);
    }
    this.session++;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else if (this.busy && this.status.textContent === 'Starting recording…') { this.busy = false; this.imageButton.disabled = this.videoButton.disabled = false; this.message(''); }
  }

  private finishVideo(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined; this.recorder = undefined; this.recording = false; this.busy = false;
    this.imageButton.disabled = this.videoButton.disabled = false;
    this.videoButton.classList.remove('recording');
    this.videoButton.title = 'Start video recording';
    this.videoButton.setAttribute('aria-label', this.videoButton.title);
    this.videoButton.querySelector('span')!.textContent = 'videocam';
    if (this.status.textContent === 'Recording') this.message('');
  }
}
