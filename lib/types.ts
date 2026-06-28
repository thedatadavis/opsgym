export type DecisionKind = "pass" | "fail" | "wait";

export type GapType =
  | "policy_gap"
  | "principle_conflict"
  | "missing_context"
  | "ambiguous_exception"
  | "logic_gap"
  | "permission_gap"
  | "meta_gap";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type RunSource = "ui" | "api";

export interface Principle {
  id: string;
  title: string;
  body: string;
}

export interface DecisionResult {
  decision: DecisionKind;
  matchedPolicy: string[];
  rationale: string;
  confidence: number;
  missingContext: string[];
  gapType?: GapType;
}

export interface DecisionRun extends DecisionResult {
  id: string;
  policyId: string;
  action: string;
  context?: Record<string, unknown>;
  source: RunSource;
  createdAt: string;
  queueItemId?: string;
}

export interface ProposedChange {
  id: string;
  queueItemId: string;
  title: string;
  before: string;
  after: string;
  status: ApprovalStatus;
  createdAt: string;
}

export interface DecisionQueueItem {
  id: string;
  policyId: string;
  runId: string;
  action: string;
  gapType: GapType;
  missingContext: string[];
  rationale: string;
  status: "open" | "resolved" | "rejected";
  proposedChange: ProposedChange;
  createdAt: string;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  policy: string;
  principles: Principle[];
  endpointPath: string;
  runs: DecisionRun[];
  decisionQueue: DecisionQueueItem[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRequest {
  action: string;
  context?: Record<string, unknown>;
}

export interface DecisionResponse extends DecisionResult {
  runId: string;
  policyId: string;
  action: string;
  queueItemId?: string;
  createdAt: string;
}
