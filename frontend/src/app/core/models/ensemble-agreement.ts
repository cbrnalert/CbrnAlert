export interface AgreementInfo {
  memberCount: number;
  description: string;
  counts?: number[][];
  validCounts?: number[][];
}
export interface PeriodAgreement {
  values: (number | null)[][];
  counts: number[][];
  validCounts: number[][];
  memberCount: number;
  width: number; height: number;
  xmin: number; xmax: number; ymin: number; ymax: number;
  startTime: string; endTime: string;
}
