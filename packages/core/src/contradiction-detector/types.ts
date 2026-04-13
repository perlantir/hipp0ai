export interface ContradictionAnalysis {
  conflicts: boolean;
  severity: 'critical' | 'warning' | 'info';
  explanation: string;
  resolution_suggestion: string;
}
