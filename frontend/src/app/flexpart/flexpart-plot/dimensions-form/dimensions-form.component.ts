import { MapPlotAction } from 'src/app/core/state/map-plot.state';
import { GeoJsonSliceResponse } from './../../../core/api/models/geo-json-slice-response';
import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { UntypedFormGroup, FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Observable, of } from 'rxjs';
import { DropdownQuestion } from 'src/app/shared/form/dropdown-question';
import { QuestionBase } from 'src/app/shared/form/question-base';
import { FlexpartService } from '../../flexpart.service';
import { Store } from '@ngxs/store';
import { switchMap, tap, take } from 'rxjs/operators';
import { SliceResponseType } from 'src/app/flexpart/flexpart-plot-data';

@Component({
  selector: 'app-dimensions-form',
  templateUrl: './dimensions-form.component.html',
  styleUrls: ['./dimensions-form.component.scss'],
})
export class DimensionsFormComponent implements OnChanges {

  @Input() runId: string
  @Input() outputId: string
  @Input() layerName: { value: string; label: string };

  formGroup: UntypedFormGroup;
  questions$: Observable<QuestionBase<any>[]>;
  isLoading = true;
  ensembleVisible = false;
  animationVisible = false;
  analysisVisible = false;
  get isEnsemble(): boolean {
    return !!this.flexpartService.runsSubject.value.find(run => run.uuid === this.runId)?.ensemble;
  }
  dims: {[key: string]: string[] | number[]} = {};

  get responseFormat() {
    return this.flexpartService.selectedSliceType;
  }

  constructor(
    private route: ActivatedRoute,
    private flexpartService: FlexpartService,
    private store: Store
  ) {
    this.formGroup = new UntypedFormGroup({});
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.ensembleVisible = false;
    this.animationVisible = false;
    this.analysisVisible = false;
    const newOutId = changes["outputId"] ? changes["outputId"].currentValue : this.outputId;
    let newLayer: string | undefined;
    if (changes["layerName"] && changes["layerName"].currentValue) {
      newLayer = changes["layerName"].currentValue.value;
    } else if (this.layerName) {
      newLayer = this.layerName.value;
    }
    if (newOutId && newLayer) {
      this.formGroup = new UntypedFormGroup({});
      this.flexpartService.getZDims(newOutId, newLayer).pipe(take(1)).subscribe(dims => {
        this.dims = dims as {[key: string]: string[] | number[]};
      });
      this.questions$ = this.flexpartService.getDimsQuestions(newOutId, newLayer).pipe(
        tap((questions) => {
          questions.forEach((question) => {
            if (question.key === 'Ti') {
              question.label = 'Time';
            }
          });
          this.isLoading = false;
        })
      );
    }
  }

  onSubmit() {
    this.animationVisible = false;
    this.analysisVisible = false;
    const outputId = this.outputId;
    const layerName = this.layerName.value;
    const toGeoJSON = this.responseFormat == SliceResponseType.GEOJSON
    let simType: 'ensemble' | 'deterministic';

    this.flexpartService.runs$.pipe(take(1)).subscribe((runs) => {
      const run = runs.find(r => r.uuid === this.runId);
      simType = run?.ensemble ? 'ensemble' : 'deterministic';
    })

    const selectedDimensions: { [key: string]: { index: number, value: string | number } } = {};
    ['Ti', 'height'].forEach(key => {
      const dimArray = this.dims[key];
      const value = this.formGroup.value.dimensions[key];
      if (dimArray) {
        const index = dimArray.findIndex(v => v == value);
        selectedDimensions[key] = {
          index: index + 1,
          value: value
        };
      }
    });
    selectedDimensions['substance'] = { index: 1, value: this.layerName.label };
    
    if ('height' in this.formGroup.value.dimensions) {
      this.formGroup.value.dimensions['height'] = parseFloat(this.formGroup.value.dimensions['height'] as string);
    }

    if (toGeoJSON) {
      this.flexpartService.getSliceJson(outputId as string, layerName as string, toGeoJSON, this.formGroup.value.dimensions).subscribe(res => {
        const geores = res as GeoJsonSliceResponse;
        this.store.dispatch(new MapPlotAction.Add(geores, 'flexpart', outputId, simType, selectedDimensions))
      })
    } else {
      this.flexpartService.getSliceTiff(outputId as string, layerName as string, toGeoJSON, this.formGroup.value.dimensions).subscribe(res => {
        this.store.dispatch(new MapPlotAction.AddTiff(res, 'flexpart', outputId, simType, selectedDimensions))
      })
    }
  }

}
