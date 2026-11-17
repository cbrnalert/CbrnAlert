export type ArrivalHistogramBin = [number, number]; // [zero-based output index, member count]
export interface AgreementInfo {
  threshold?: number;
  unit?: string;
  analysis?: 'arrival' | 'maximum' | 'timestep' | 'duration';
  concentrationValues?: [number, number][][][];
  durationHours?: number;
  durationValues?: [number, number][][][];
  maximumValues?: [number, number][][][];
  startTime?: string;
  arrivalLower?: (number | null)[][];
  arrivalUpper?: (number | null)[][];
  arrivalCounts?: number[][];
  arrivalHistogram?: ArrivalHistogramBin[][][];
  arrivalTimes?: string[];
  memberCount: number;
  description: string;
  counts?: number[][];
  validCounts?: number[][];
}
export interface PeriodAgreement {
  memberContours?: {member: number; cells: number[]}[];
  analysis?: 'arrival' | 'maximum' | 'timestep' | 'duration';
  concentrationValues?: [number, number][][][];
  durationHours?: number;
  durationValues?: [number, number][][][];
  maximumValues?: [number, number][][][];
  arrivalLower?: (number | null)[][];
  arrivalUpper?: (number | null)[][];
  arrivalCounts?: number[][];
  arrivalHistogram?: ArrivalHistogramBin[][][];
  arrivalTimes?: string[];
  values: (number | null)[][];
  counts: number[][];
  validCounts: number[][];
  memberCount: number;
  width: number; height: number;
  xmin: number; xmax: number; ymin: number; ymax: number;
  startTime: string; endTime: string;
}
