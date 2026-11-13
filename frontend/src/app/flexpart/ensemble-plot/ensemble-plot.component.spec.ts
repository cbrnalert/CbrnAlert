import type { CdkDrag } from '@angular/cdk/drag-drop';
import { OverlayContainer, OverlayModule } from '@angular/cdk/overlay';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { AnimationSeries } from '../animation/animation-model';
import { EnsemblePlotComponent } from './ensemble-plot.component';
import { FlexpartService } from '../flexpart.service';
import { MapService } from 'src/app/core/services/map.service';

@Component({
  selector: 'test-on-push-plot-window',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-ensemble-plot outputId="output" layer="spec001_mr" [dimensions]="dimensions"></app-ensemble-plot>'
})
class OnPushPlotWindow {
  dimensions = { height: 1 };
}

@Component({ template: '<test-on-push-plot-window></test-on-push-plot-window>' })
class TestRoot {}

describe('Ensemble plot beneath an OnPush plot window', () => {
  let fixture: ComponentFixture<TestRoot>;
  let response: Subject<AnimationSeries>;
  let overlayElement: HTMLElement;

  beforeEach(async () => {
    response = new Subject<AnimationSeries>();
    await TestBed.configureTestingModule({
      declarations: [TestRoot, OnPushPlotWindow, EnsemblePlotComponent],
      imports: [CommonModule, OverlayModule],
      providers: [
        { provide: FlexpartService, useValue: { getAnimationSeries: () => response } },
        { provide: MapService, useValue: {} }
      ]
    }).overrideComponent(EnsemblePlotComponent, {
      set: {
        template: `<ng-template #floatingPanel><button (click)="plot()">Plot</button>
          <span class="state">{{loading ? 'Generating' : error}}</span>
          <span *ngIf="series" class="chart-ready">Chart ready</span></ng-template>`,
        styles: [],
        styleUrls: []
      }
    }).compileComponents();
    fixture = TestBed.createComponent(TestRoot);
    fixture.detectChanges();
    overlayElement = TestBed.inject(OverlayContainer).getContainerElement();
    const panel = fixture.debugElement.query(By.directive(EnsemblePlotComponent)).componentInstance as EnsemblePlotComponent;
    spyOn<any>(panel, 'renderChart').and.resolveTo();
    panel.coordinates.setValue({ latitude: 45.645, longitude: 7.705 });
    overlayElement.querySelector('button')!.click();
    fixture.detectChanges();
    expect(overlayElement.querySelector('.state')!.textContent).toContain('Generating');
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('resizes from a corner and releases its pointer listeners', () => {
    const panel = fixture.debugElement.query(By.directive(EnsemblePlotComponent)).componentInstance as EnsemblePlotComponent;
    const element = document.createElement('section');
    element.className = 'ensemble-panel';
    overlayElement.appendChild(element);
    spyOn(element, 'getBoundingClientRect').and.returnValue({
      left: 100, right: 500, top: 100, bottom: 400, width: 400, height: 300
    } as DOMRect);
    panel.startResize({
      button: 0, pointerId: 7, clientX: 100, clientY: 100, currentTarget: element,
      preventDefault: () => {}, stopPropagation: () => {}
    } as unknown as PointerEvent, 'nw', { reset: () => {} } as CdkDrag);
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      document.dispatchEvent(event);
    };
    pointer('pointermove', 60, 50);
    expect(panel.panelWidth).toBe(440);
    expect(panel.panelHeight).toBe(350);
    pointer('pointermove', 1000, 1000);
    expect(panel.panelWidth).toBe(320);
    expect(panel.panelHeight).toBe(200);
    pointer('pointerup', 1000, 1000);
    pointer('pointermove', 60, 50);
    expect(panel.panelWidth).toBe(320);
    element.remove();
  });

  it('replaces the loading message with the chart when the HTTP response arrives', () => {
    response.next({times: ['2026-01-10T01:00:00Z'], latitude: 45.645, longitude: 7.705, unit: 'ng/m³', ensemble: false, concentration: [1]});
    response.complete();
    fixture.detectChanges();
    expect(overlayElement.querySelector('.state')!.textContent).not.toContain('Generating');
    expect(overlayElement.querySelector('.chart-ready')!.textContent).toBe('Chart ready');
  });

  it('shows asynchronous errors instead of leaving the loading message visible', () => {
    response.error(new Error('Request failed'));
    fixture.detectChanges();
    expect(overlayElement.querySelector('.state')!.textContent).toContain('Unable to plot');
  });

  it('shows a timeout beneath the OnPush parent', fakeAsync(() => {
    // Start a request inside the virtual timer zone.
    const panel = fixture.debugElement.query(By.directive(EnsemblePlotComponent)).componentInstance as EnsemblePlotComponent;
    panel.cancelPlot();
    overlayElement.querySelector('button')!.click();
    fixture.detectChanges();
    tick(90001);
    fixture.detectChanges();
    expect(overlayElement.querySelector('.state')!.textContent).toContain('timed out');
  }));
});
