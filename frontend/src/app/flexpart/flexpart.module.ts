import { EnsembleAnalysisComponent } from './ensemble-analysis/ensemble-analysis.component';
import { AnimationComponent } from './animation/animation.component';
import { OverlayModule } from '@angular/cdk/overlay';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ReactiveFormsModule } from '@angular/forms';
import { EnsemblePlotComponent } from './ensemble-plot/ensemble-plot.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { FlexpartPlotComponent } from './flexpart-plot/flexpart-plot.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '../shared/shared.module';
import { FlexpartService } from './flexpart.service';
import { FlexpartRoutingModule } from './flexpart-routing.module';
import { VariableSelectionComponent } from './flexpart-plot/variable-selection/variable-selection.component';
import { DimensionsFormComponent } from './flexpart-plot/dimensions-form/dimensions-form.component';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatStepperModule } from '@angular/material/stepper';
import { PlotStepperComponent } from './plot-stepper/plot-stepper.component';
import { OutputsComponent } from './flexpart-plot/outputs/outputs.component';
import { RunStepperComponent } from './run-stepper/run-stepper.component';
import { InputsComponent } from './inputs/inputs.component';
import { RunSimpleComponent } from './run-simple/run-simple.component';
import { ReleaseFormComponent } from './run-simple/release-form/release-form.component';
import { CommandFormComponent } from './run-simple/command-form/command-form.component';
import { OutgridFormComponent } from './run-simple/outgrid-form/outgrid-form.component';
import { RetrieveMeteoSimpleComponent } from './retrieve-meteo-simple/retrieve-meteo-simple.component';
import { LocationFormModule } from 'src/app/shared/form/location-form/location-form.module';
import { FaIconLibrary, FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEraser, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DialogModule } from 'src/app/shared/ui/dialogs/dialog.module';

@NgModule({
    declarations: [
        EnsembleAnalysisComponent,
        AnimationComponent,
        EnsemblePlotComponent,
        FlexpartPlotComponent,
        OutputsComponent,
        VariableSelectionComponent,
        DimensionsFormComponent,
        PlotStepperComponent,
        RunStepperComponent,
        InputsComponent,
        RunSimpleComponent,
        ReleaseFormComponent,
        CommandFormComponent,
        OutgridFormComponent,
        RetrieveMeteoSimpleComponent,
    ],
    providers: [
        FlexpartService,
        // ResultResolverService,
    ],
    imports: [
        OverlayModule,
        DragDropModule,
        ReactiveFormsModule,
        FlexpartRoutingModule,
        CommonModule,
        SharedModule,
        MatTabsModule,
        MatProgressSpinnerModule,
        MatListModule,
        MatSelectModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatTabsModule,
        MatStepperModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatTooltipModule,
        LocationFormModule,
        FontAwesomeModule,
        DialogModule
    ],
    exports: [
        // MetDataComponent,
        // FlexpartRunPreloadedComponent,
        // FlexpartPlotComponent,
    ]
})
export class FlexpartModule {
  constructor(library: FaIconLibrary) {
    // Add an icon to the library for convenient access in other components
    library.addIcons(faTrash);
  }
 }
