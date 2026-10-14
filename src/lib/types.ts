/**
 * FinShield AI — Core Type Definitions
 * 
 * Shared types used across client, server, and database layers.
 * These are the source-of-truth TypeScript schemas for the application.
 */

// ─── Task States ─────────────────────────────────────────────────────
export const TASK_STATES = [
  'submitted',
  'queued',
  'validating',
  'extracting',
  'security_analysis',
  'risk_analysis',
  'policy_check',
  'awaiting_review',
  'allowed',
  'blocked',
  'executing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskState = typeof TASK_STATES[number];

/** Valid state transitions — enforced server-side */
export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  submitted: ['queued', 'failed', 'cancelled'],
  queued: ['validating', 'failed', 'cancelled'],
  validating: ['extracting', 'failed', 'cancelled'],
  extracting: ['security_analysis', 'failed', 'cancelled'],
  security_analysis: ['risk_analysis', 'blocked', 'failed', 'cancelled'],
  risk_analysis: ['policy_check', 'blocked', 'failed', 'cancelled'],
  policy_check: ['allowed', 'blocked', 'awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['allowed', 'blocked', 'cancelled'],
  allowed: ['executing', 'completed', 'failed'],
  blocked: [], // Terminal state — no transitions out
  executing: ['completed', 'failed'],
  completed: [], // Terminal
  failed: ['queued'], // Can retry → re-queue
  cancelled: [], // Terminal
};

export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalState(state: TaskState): boolean {
  return VALID_TRANSITIONS[state]?.length === 0;
}

export function isProcessingState(state: TaskState): boolean {
  return ['validating', 'extracting', 'security_analysis', 'risk_analysis', 'policy_check', 'executing'].includes(state);
}

// ─── Decision Types ──────────────────────────────────────────────────
export type Decision = 'ALLOW' | 'BLOCK' | 'VERIFY';

export const DECISIONS: Decision[] = ['ALLOW', 'BLOCK', 'VERIFY'];

// ─── Task Types ──────────────────────────────────────────────────────
export const TASK_TYPES = [
  'invoice_verification',
  'vendor_verification',
  'payment_preparation',
  'account_reconciliation',
  'document_review',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  invoice_verification: 'Invoice Verification',
  vendor_verification: 'Vendor Verification',
  payment_preparation: 'Payment Preparation',
  account_reconciliation: 'Account Reconciliation',
  document_review: 'Document Review',
};

// ─── File Validation ─────────────────────────────────────────────────
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'text/plain',
] as const;

export const ALLOWED_EXTENSIONS = ['.pdf', '.csv', '.txt'] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

// ─── User Roles ──────────────────────────────────────────────────────
export const USER_ROLES = ['admin', 'reviewer', 'analyst', 'viewer'] as const;
export type UserRole = typeof USER_ROLES[number];

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Task ────────────────────────────────────────────────────────────
export interface Task {
  id: string;
  task_number: string; // Human-readable "FS-1001"
  type: TaskType;
  state: TaskState;
  title: string;
  instructions: string | null;
  submitter_id: string;
  submitter_email: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  file_type: string | null;
  reference_id: string | null;
  risk_score: number | null;
  decision: Decision | null;
  model_confidence: number | null;
  policy_checks?: PolicyCheckResult[];
  idempotency_key: string | null;
  retry_count: number;
  max_retries: number;
  execution_status?: SandboxExecution['status'] | null;
  execution_reference?: string | null;
  error_message: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ─── Task Event ──────────────────────────────────────────────────────
export type TaskEventType =
  | 'task_submitted'
  | 'task_queued'
  | 'file_uploaded'
  | 'file_validated'
  | 'extraction_started'
  | 'extraction_completed'
  | 'extraction_failed'
  | 'ocr_completed'
  | 'security_analysis_started'
  | 'security_findings_recorded'
  | 'security_analysis_completed'
  | 'risk_evaluation_started'
  | 'risk_evaluation_completed'
  | 'policy_check_started'
  | 'policy_check_completed'
  | 'decision_generated'
  | 'marked_for_review'
  | 'review_approved'
  | 'review_rejected'
  | 'review_info_requested'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'task_retried'
  | 'state_transition'
  | 'error';

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type: TaskEventType;
  previous_state: TaskState | null;
  next_state: TaskState | null;
  actor: string; // user email, 'system', 'agent-1', etc.
  service: string; // 'api', 'worker', 'review', etc.
  correlation_id: string;
  details: Record<string, unknown> | null;
  evidence_ref: string | null;
  policy_version: string | null;
  model_version: string | null;
  created_at: string;
}

// ─── Extracted Fields ────────────────────────────────────────────────
export interface ExtractedFields {
  id: string;
  task_id: string;
  invoice_number: string | null;
  vendor_name: string | null;
  vendor_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  currency: string | null;
  account_number: string | null;
  bank_details: string | null;
  description: string | null;
  requested_action: string | null;
  raw_text: string | null;
  confidence_scores: Record<string, number> | null;
  extraction_method: string | null;
  missing_fields: string[];
  warnings: string[];
  provenance: Record<string, unknown> | null;
  created_at: string;
}

// ─── Security Findings ──────────────────────────────────────────────
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'prompt_injection'
  | 'malicious_instructions'
  | 'vendor_mismatch'
  | 'duplicate_invoice'
  | 'amount_anomaly'
  | 'missing_information'
  | 'suspicious_content'
  | 'policy_violation'
  | 'unauthorized_action'
  | 'data_inconsistency';

export interface SecurityFinding {
  id: string;
  task_id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: string | null;
  evidence_location: string | null;
  is_confirmed: boolean;
  requires_review: boolean;
  remediation: string | null;
  created_at: string;
}

// ─── Policy Rules ───────────────────────────────────────────────────
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  category: string;
  rule_type: 'mandatory' | 'advisory';
  conditions: Record<string, unknown>;
  action: 'block' | 'verify' | 'flag';
  is_active: boolean;
  version: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Evaluation Result ──────────────────────────────────────────────
export interface EvaluationResult {
  id: string;
  task_id: string;
  decision: Decision;
  risk_score: number;
  model_confidence: number | null;
  policy_checks?: PolicyCheckResult[];
  security_findings_count: number;
  policy_checks_passed: number;
  policy_checks_failed: number;
  policy_checks_total: number;
  evidence_summary: string;
  explanation: string;
  requires_review: boolean;
  review_reason: string | null;
  policy_version: string;
  model_provider: string | null;
  model_id: string | null;
  model_version: string | null;
  is_simulated: boolean;
  raw_output: Record<string, unknown> | null;
  created_at: string;
}

// ─── Human Review ───────────────────────────────────────────────────
export type ReviewDecision = 'approved' | 'rejected' | 'info_requested';

export interface HumanReview {
  id: string;
  task_id: string;
  reviewer_id: string;
  reviewer_email: string | null;
  decision: ReviewDecision;
  reason: string;
  policy_version: string;
  previous_state: TaskState;
  created_at: string;
}

// ─── Sandbox Execution ─────────────────────────────────────────────
export type ExecutionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface SandboxExecution {
  id: string;
  task_id: string;
  operation_type: TaskType;
  operation_details: Record<string, unknown>;
  authorization_ref: string; // evaluation_result ID or review ID
  idempotency_key: string;
  status: ExecutionStatus;
  mock_reference_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  executed_by: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Notification Preferences ───────────────────────────────────────
export interface NotificationPreferences {
  id: string;
  user_id: string;
  sound_enabled: boolean;
  sound_allow: boolean;
  sound_block: boolean;
  sound_verify: boolean;
  email_notifications: boolean;
  desktop_notifications: boolean;
  created_at: string;
  updated_at: string;
}

// ─── API Response Types ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Dashboard Metrics ──────────────────────────────────────────────
export interface DashboardMetrics {
  totalToday: number;
  allowedToday: number;
  blockedToday: number;
  verifyToday: number;
  pendingTasks: number;
  processing: number;
  highRiskAlerts: number;
  pendingReviews: number;
  avgProcessingMs: number;
}

// ─── Synthetic Demo Data Markers ────────────────────────────────────
export interface DemoMarker {
  isDemo: boolean;
  label: string;
  description: string;
}

// ─── Agent Pipeline Types ───────────────────────────────────────────

/** Agent 1 output — document processing */
export interface DocumentProcessingResult {
  success: boolean;
  extractedFields: Partial<ExtractedFields>;
  rawText: string;
  extractionMethod: string;
  confidence: Record<string, number>;
  missingFields: string[];
  warnings: string[];
  processingTimeMs: number;
}

/** Agent 2 output — security analysis */
export interface SecurityAnalysisResult {
  success: boolean;
  findings: Omit<SecurityFinding, 'id' | 'task_id' | 'created_at'>[];
  riskScore: number;
  modelConfidence: number | null;
  overallThreatLevel: FindingSeverity;
  checksPerformed: string[];
  processingTimeMs: number;
}

/** Agent 3 output — policy evaluation */
export interface PolicyEvaluationResult {
  success: boolean;
  decision: Decision;
  riskScore: number;
  modelConfidence: number | null;
  modelProvider: string;
  modelId: string;
  policyChecks: PolicyCheckResult[];
  explanation: string;
  requiresReview: boolean;
  reviewReason: string | null;
  evidenceSummary: string;
  processingTimeMs: number;
}

export interface PolicyCheckResult {
  policyId: string;
  policyName: string;
  action: 'block' | 'verify' | 'flag';
  passed: boolean;
  details: string;
  evidence: string | null;
}
