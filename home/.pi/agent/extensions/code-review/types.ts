export interface ReviewResult {
  /** The review text (the subagent's final response). */
  output: string;
  /** Persistent review session ID. Pass this to continue_code_review. */
  sessionId: string;
  /** JSONL path in the dedicated review session directory. */
  sessionFile?: string;
  aborted: boolean;
  error?: string;
}
