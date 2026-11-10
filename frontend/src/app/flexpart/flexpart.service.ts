import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../core/api/api-configuration';
import { SliceResponseType } from './flexpart-plot-data';
import { FlexpartRetrieveSimple } from './../core/api/models/flexpart-retrieve-simple';
import { BehaviorSubject, combineLatest, Observable, of, Subject, throwError, firstValueFrom } from 'rxjs';
import { Injectable } from '@angular/core';
import { FlexpartResult } from 'src/app/flexpart/flexpart-result';
import { FlexpartOptionsSimple, FlexpartOutput, FlexpartRun } from 'src/app/core/api/models';
import { QuestionBase } from '../shared/form/question-base';
import { DropdownQuestion } from '../shared/form/dropdown-question';
import { FlexpartInput } from '../core/api/models/flexpart-input';
import * as dayjs from 'dayjs';
import { MapArea } from 'src/app/core/models/map-area';
import { NiceInput } from 'src/app/flexpart/models/nice-input';
import { FlexpartApiService } from 'src/app/core/api/services';
import { concatMap, map, switchMap, tap, withLatestFrom } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class FlexpartService {

  inputs: FlexpartInput[] = [];
  results: FlexpartResult[] = [];
  // plots: FlexpartPlotData[] = [];

  selectedInputSubject = new BehaviorSubject<FlexpartInput | undefined>(undefined);
  selectedInput$: Observable<FlexpartInput | undefined> = this.selectedInputSubject.asObservable();

  runsSubject = new BehaviorSubject<FlexpartRun[]>([]);
  runs$ = this.runsSubject.asObservable();

  inputsSubject = new BehaviorSubject<FlexpartInput[]>([]);
  inputs$ = this.inputsSubject.asObservable();

  // plotsSubject = new Subject<FlexpartPlot>();

  _selectedSliceType = SliceResponseType.GEOTIFF
  get selectedSliceType() { return this._selectedSliceType }
  set selectedSliceType(t: SliceResponseType) {
    this._selectedSliceType = t
  }

  constructor(
    private apiService: FlexpartApiService,
    private http: HttpClient,
    private apiConfiguration: ApiConfiguration,
  ) { }

  // getInputs(): Observable<FlexpartInput[]> {
  //     return this.apiService_old
  //         .get('/flexpart/inputs')
  //         .pipe(
  //             map((data: any) => {
  //                 data.forEach((element: any) => {
  //                     element.startDate = new Date(element.startDate);
  //                     element.endDate = new Date(element.endDate);
  //                 });
  //                 return <FlexpartInput[]>data;
  //             })
  //         );
  // }

  newSelectedInput(input:FlexpartInput) {
    this.selectedInputSubject.next(input);
  }

  retrieveSimple(retrieval:FlexpartRetrieveSimple) {
    return this.apiService.flexpartInputPost({
      retrievalType: 'simple',
      body: retrieval
    })
  }

  getInputStart(input:FlexpartInput) {
    const control = input.control;
    const startDate = control['START_DATE'];
    const hour = control['TIME'].split(" ")[0];
    const step = parseInt(control['STEP'].split(" ")[0], 10);
    return dayjs(startDate + 'T' + hour).add(step, 'hour').toDate();
  }

  getInputEnd(input:FlexpartInput) {
    const control = input.control;
    const start = this.getInputStart(input)
    const steps = control['TIME'].split(" ")
    const timeStep = this.getInputTimeStep(input)
    const hours = timeStep * (steps.length - 1)
    return dayjs(start).add(hours, 'hour').toDate();
  }

  getInputArea(input:FlexpartInput): MapArea {
    const control = input.control;
    return {
      top: parseFloat(control['UPPER']),
      left: parseFloat(control['LEFT']),
      right: parseFloat(control['RIGHT']),
      bottom: parseFloat(control['LOWER']),
    }
  }

  getInputTimeStep(input:FlexpartInput) {
    const control = input.control;
    return parseInt(control["DTIME"]);
  }

  niceInput(input:FlexpartInput) : NiceInput {
    return {
      start: this.getInputStart(input),
      end: this.getInputEnd(input),
      area: this.getInputArea(input),
      timeStep: this.getInputTimeStep(input)
    }
  }

  getInputs() {
    return this.apiService.flexpartInputsGet();
  }

  postRunSimple(body: FlexpartOptionsSimple, inputId: string) {
    return this.apiService.flexpartRunPost({
      runType: 'simple',
      inputId,
      body,
    })
  }

  getRuns(): Observable<FlexpartRun[]> {
    return this.apiService.flexpartRunsGet();
  }

  updateRunsFromServer(): Promise<void> {
    return firstValueFrom(
      this.getRuns().pipe(
        map(runs => {
          this.runsSubject.next(runs);
        })
      )
    );
  }

  updateInputsFromServer(): Promise<void> {
    return firstValueFrom(
      this.getInputs().pipe(
        map(inputs => {
          this.inputsSubject.next(inputs);
        })
      )
    );
  }

  deleteInput(inputId: string) {
    var deleted: FlexpartInput|undefined;
    this.apiService.flexpartInputsInputIdDelete({ inputId }).pipe(
      withLatestFrom(this.inputs$),
      map(([apiRes, currentInputs]) => {
        deleted = apiRes;
        const newInputs = currentInputs.filter(r => r.uuid !== apiRes.uuid);
        console.log(`deleted to ${newInputs}`)
        return newInputs;
      }),
    ).subscribe(newInputs => {
      this.inputsSubject.next(newInputs);
    });
    return deleted;
  }

  deleteRun(runId: string) {
    this.apiService.flexpartRunsRunIdDelete({ runId }).pipe(
      withLatestFrom(this.runs$),
      map(([apiRes, currentRuns]) => {
        const newRuns = currentRuns.filter(r => r.uuid !== apiRes.uuid);
        console.log(`deleted to ${newRuns}`)
        return newRuns;
      }),
    ).subscribe(newruns => {
      this.runsSubject.next(newruns);
    });

    // @COMMENT: Other idea FROM: https://www.youtube.com/watch?v=SXOZaWLs4q0. Not using it since I don't know if the subscription is killed when call to API completes
    // combineLatest({
    //   apiRes: this.apiService.flexpartRunsRunIdDelete({ runId }),
    //   currentRuns: this.runs$
    // }).subscribe(({ apiRes, currentRuns }) => {
    //   const newRuns = currentRuns.filter(r => r.uuid !== apiRes.uuid);
    //   console.log(`deleted to ${newRuns}`);
    //   this.runsSubject.next(newRuns);
    // })
  }

  renameInput(inputId: string, newName: string): Observable<FlexpartInput> {
    return this.apiService.flexpartInputsInputIdPut({ inputId, newName }).pipe(
      withLatestFrom(this.inputs$),
      map(([apiRes, currentInputs]) => {
        const updatedInputs = currentInputs.map(input =>
          input.uuid === apiRes.uuid ? { ...input, name: apiRes.name } : input
        );
        this.inputsSubject.next(updatedInputs);
        return apiRes;
      })
    );
  }

  renameRun(runId: string, newName: string): Observable<FlexpartRun> {
    return this.apiService.flexpartRunsRunIdPut({ runId, newName }).pipe(
      withLatestFrom(this.runs$),
      map(([apiRes, currentRuns]) => {
        const updatedRuns = currentRuns.map(run =>
          run.uuid === apiRes.uuid ? { ...run, name: apiRes.name } : run
        );
        this.runsSubject.next(updatedRuns);
        return apiRes;
      })
    );
  }

  getRun(runId: string): Observable<FlexpartRun> {
    return this.apiService.flexpartRunsRunIdGet({ runId })
  }

  getOutputs(runId: string): Observable<FlexpartOutput[]> {
    return this.apiService.flexpartRunsRunIdOutputsGet({ runId })
  }

  getOutput(outputId: string): Observable<FlexpartOutput> {
    return this.apiService.flexpartOutputsOutputIdGet({ outputId })
  }

  getSpatialLayers(outputId: string): Observable<string[]> {
    return this.apiService.flexpartOutputsOutputIdLayersGet({ outputId, spatial: true })
  }

  getZDims(outputId: string, layer: string): Observable<Object> {
    return this.apiService.flexpartOutputsOutputIdDimensionsGet({ outputId, layer, horizontal: false })
  }

  getSlice(outputId: string, layerName: string, geojson: boolean, dimensions: Object) {
    const f = geojson ? this.apiService.flexpartOutputsOutputIdSlicePost$Json : this.apiService.flexpartOutputsOutputIdSlicePost$Tiff
    return f({
      outputId,
      layer: layerName,
      geojson: geojson,
      legend: true,
      body: dimensions
    })
  }

  getSliceJson(outputId: string, layerName: string, geojson: boolean, dimensions: Object) {
    return this.apiService.flexpartOutputsOutputIdSlicePost$Json({
      outputId,
      layer: layerName,
      geojson: geojson,
      legend: true,
      body: dimensions
    })
  }

  getSliceTiff(outputId: string, layerName: string, geojson: boolean, dimensions: Object) {
    return this.apiService.flexpartOutputsOutputIdSlicePost$Tiff({
      outputId,
      layer: layerName,
      geojson: geojson,
      legend: true,
      body: dimensions
    })
  }

  getDimsQuestions(outputId: string, layer: string): Observable<QuestionBase<any>[]> {
    const questions: QuestionBase<any>[] = [];
    return this.getZDims(outputId, layer).pipe(
      switchMap(dims => {
        for (const [key, values] of Object.entries(dims as { [k: string]: string[] | number[] })) {
          const kvs = values.map((v) => {
            return { key: v as string, value: v as string }
          })
          questions.push(new DropdownQuestion({
            key: key,
            label: key,
            options: kvs,
            required: true,
            value: values[0],
            // order: 3
          }))
          // this.formGroup.addControl(key, new FormControl(values[0]))
          // this.dimNames.push(key);
          // this.dimValues.push(values);
        }
        return of(questions);
      })
    );
  }

  getEnsembleTimeSeries(outputId: string, layer: string, latitude: number, longitude: number,
    dimensions: {[key: string]: string | number}) {
    return this.http.post(`${this.apiConfiguration.rootUrl}/flexpart/outputs/${encodeURIComponent(outputId)}/timeseries`,
      { latitude, longitude, dimensions }, { params: { layer }, responseType: 'blob' });
  }

  getEnsembleStats(outputId: string, layerName: string, dims: {[key: string]: number}, threshold: number) {
    return this.apiService.flexpartOutputsOutputIdStatsPost({
      outputId,
      layer: layerName,
      body: {dims, threshold}
    })
  }

  meteoDataRetrieval(payload: any) {
    // const notifTitle = this.notificationService.addNotif('Met data retrieval', 'metDataRequest');
    // this.store
    //   .dispatch(new NotifAction.Add('Met data retrieval', 'metDataRequest'))
    //   .pipe(withLatestFrom(this.))
    // const plWs = {...payload,
    //     ws_info: { channel: this.websocketService.channel, backid: notifTitle },
    // }

    // console.log(plWs);
    // return this.apiService_old.post('/flexpart/meteo_data_request', plWs).pipe(
    //     catchError((err) => {
    //         this.notificationService.changeStatus(notifTitle, 'failed');
    //         return throwError(err);
    //     }),
    //     tap(() => {
    //         alert("Meteorological data has been retrieved");
    //         this.notificationService.changeStatus(notifTitle, 'succeeded');
    //     })
    // );
  }

  updateInputs(): void {
    // this.getInputs().subscribe((flexpartInputs) => {
    //     this.inputs = flexpartInputs;
    //     this.emitInputsSubject();
    // });
  }

  // updateResults(): void {
  //     this.getResultsFromServer().subscribe((flexpartResults) => {
  //         this.results = flexpartResults;
  //         this.emitResultsSubject();
  //     });
  // }

  // runFlexpart(formFields: any): void {
  //     const notifTitle = this.notificationService.addNotif('Flexpart Run', 'flexpartRun');
  //     const payload = {
  //         ...formFields,
  //         ws_info: { channel: this.websocketService.channel, backid: notifTitle },
  //         request: 'flexpart_run'
  //     }

  //     this.apiService_old.post('/flexpart/run',payload).subscribe({
  //         next: () => {
  //             alert("Flexpart run done");
  //             this.notificationService.changeStatus(notifTitle, 'succeeded');
  //         },
  //         error: (error) => {
  //             alert(error.info);
  //             this.notificationService.changeStatus(notifTitle, 'failed');
  //         }
  //     })
  // }

  // newPlot(formFields: any): void {
  //     console.log(formFields);

  //     const payload = {
  //         ...formFields,
  //         request: "flexpart_geojson_conc"
  //     };

  //     this.apiService.flexpartRequest(payload).subscribe({
  //         next: (flexpartPlotData: any) => {
  //             // this.plots.push(flexpartPlotData);
  //             this.mapPlotsService.addFlexpartPlot(flexpartPlotData);
  //             // console.log(flexpartPlotData.cells);
  //             // console.log('received :' + data);
  //             // this.mapService.cbrnMap.addGeoJsonLayer(data);
  //         },
  //         error: (error) => {
  //             alert(error.info);
  //         }
  //     })
  // }

  // newPlot(resultId:string, outputId:string,formFields: any): Observable<any> {
  //     return this.apiService_old.post('/flexpart/results/'+resultId+'/output/'+outputId, formFields);
  // }

  // dailyAverage(resultId:string, outputId:string) {

  //     this.apiService_old.post('/flexpart/results/'+resultId+'/output/'+outputId).subscribe({
  //         next: () => {
  //             // this.plots.push(flexpartPlotData);
  //             alert("Average added");
  //             // console.log(flexpartPlotData.cells);
  //             // console.log('received :' + data);
  //             // this.mapService.cbrnMap.addGeoJsonLayer(data);
  //         },
  //     })
  // }

  // dailyAverage(dirname: string) {
  //     const payload = {
  //         dataDirname: dirname,
  //         request: "flexpart_daily_average"
  //     };

  //     this.apiService.flexpartRequest(payload).subscribe({
  //         next: (flexpartPlotData: any) => {
  //             // this.plots.push(flexpartPlotData);
  //             alert("Average added");
  //             // console.log(flexpartPlotData.cells);
  //             // console.log('received :' + data);
  //             // this.mapService.cbrnMap.addGeoJsonLayer(data);
  //         },
  //     })
  // }

  emitInputsSubject() {
    this.inputsSubject.next(this.inputs);
  }
}
