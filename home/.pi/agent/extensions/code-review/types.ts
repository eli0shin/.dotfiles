export interface ReviewResult {
  /** The review text (the subagent's final response). */
  output: string;
  aborted: boolean;
  error?: string;
}
