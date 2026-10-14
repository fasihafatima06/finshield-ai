/**
 * FinShield AI — Three-Agent Pipeline Engine
 * 
 * This is the core processing engine that evaluates banking tasks.
 * Each task goes through three agents in sequence:
 *   Agent 1: Document Processing & Extraction
 *   Agent 2: Security & Risk Analysis
 *   Agent 3: Policy Evaluation & Decision
 * 
 * Different tasks execute concurrently; within a single task,
 * agents execute sequentially with explicit dependencies.
 */

import {
  type Task, type TaskState, type Decision, type TaskType,
  type DocumentProcessingResult, type SecurityAnalysisResult, type PolicyEvaluationResult,
  type PolicyCheckResult, type FindingSeverity, type FindingCategory,
  type SandboxExecution, isValidTransition,
} from '@/lib/types';
import { generateCorrelationId, sleep } from '@/lib/utils';
import * as store from '@/lib/store/demo-store';
import { runAISecurityInspection, getActiveAIProvider, GEMINI_MODEL_ID, NEMOTRON_MODEL_ID } from '@/lib/engine/ai-providers';
import { parseCsvRows } from '@/lib/engine/document-parser';

const activeTaskIds = new Set<string>();

// ─── Pipeline Orchestrator ──────────────────────────────────────────

export async function processTask(taskId: string): Promise<void> {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.state !== 'submitted' || activeTaskIds.has(taskId)) return;

  const correlationId = generateCorrelationId();
  activeTaskIds.add(taskId);

  try {
    // Transition: submitted → queued
    await transitionState(taskId, 'queued', 'system', 'pipeline', correlationId);
    
    // Agent 1: Document Processing
    await transitionState(taskId, 'validating', 'agent-1', 'pipeline', correlationId);
    const docResult = await runAgent1(task, correlationId);

    if (!docResult.success) {
      await failTask(taskId, 'Document processing failed: ' + (docResult.warnings[0] || 'Unknown error'), correlationId);
      return;
    }

    await transitionState(taskId, 'extracting', 'agent-1', 'pipeline', correlationId);
    
    // Save extracted fields
    store.saveExtractedFields({
      task_id: taskId,
      invoice_number: docResult.extractedFields.invoice_number ?? null,
      vendor_name: docResult.extractedFields.vendor_name ?? null,
      vendor_id: docResult.extractedFields.vendor_id ?? null,
      invoice_date: docResult.extractedFields.invoice_date ?? null,
      due_date: docResult.extractedFields.due_date ?? null,
      amount: docResult.extractedFields.amount ?? null,
      currency: docResult.extractedFields.currency ?? null,
      account_number: docResult.extractedFields.account_number ?? null,
      bank_details: docResult.extractedFields.bank_details ?? null,
      description: docResult.extractedFields.description ?? null,
      requested_action: docResult.extractedFields.requested_action ?? null,
      raw_text: docResult.rawText,
      confidence_scores: docResult.confidence,
      extraction_method: docResult.extractionMethod,
      missing_fields: docResult.missingFields,
      warnings: docResult.warnings,
      provenance: { source: 'agent-1', method: docResult.extractionMethod },
    });

    store.addTaskEvent({
      task_id: taskId,
      event_type: 'extraction_completed',
      actor: 'agent-1',
      service: 'pipeline',
      correlation_id: correlationId,
      details: {
        method: docResult.extractionMethod,
        fieldsExtracted: Object.keys(docResult.extractedFields).length,
        missingFields: docResult.missingFields,
        processingTimeMs: docResult.processingTimeMs,
      },
    });

    // Agent 2: Security Analysis
    await transitionState(taskId, 'security_analysis', 'agent-2', 'pipeline', correlationId);
    const secResult = await runAgent2(task, docResult, correlationId);

    // Save security findings
    for (const finding of secResult.findings) {
      store.addSecurityFinding({
        task_id: taskId,
        ...finding,
      });
    }

    store.addTaskEvent({
      task_id: taskId,
      event_type: 'security_findings_recorded',
      actor: 'agent-2',
      service: 'pipeline',
      correlation_id: correlationId,
      details: {
        findingsCount: secResult.findings.length,
        riskScore: secResult.riskScore,
        threatLevel: secResult.overallThreatLevel,
        checksPerformed: secResult.checksPerformed,
        processingTimeMs: secResult.processingTimeMs,
      },
    });

    // Check for mandatory security blocks
    const hasCriticalSecurity = secResult.findings.some(
      f => f.severity === 'critical' && f.is_confirmed
    );
    const hasHighPromptInjection = secResult.findings.some(
      f => f.category === 'prompt_injection' && (f.severity === 'critical' || f.severity === 'high')
    );

    if (hasCriticalSecurity || hasHighPromptInjection) {
      // Mandatory block — cannot be overridden by LLM
      await transitionState(taskId, 'blocked', 'system', 'pipeline', correlationId);
      store.updateTask(taskId, {
        decision: 'BLOCK',
        risk_score: secResult.riskScore,
      });
      
      store.saveEvaluationResult({
        task_id: taskId,
        decision: 'BLOCK',
        risk_score: secResult.riskScore,
        model_confidence: secResult.modelConfidence,
        policy_checks: [],
        security_findings_count: secResult.findings.length,
        policy_checks_passed: 0,
        policy_checks_failed: 1,
        policy_checks_total: 1,
        evidence_summary: `Mandatory security block triggered: ${secResult.findings.filter(f => f.severity === 'critical' && f.is_confirmed || f.category === 'prompt_injection' && (f.severity === 'critical' || f.severity === 'high')).map(f => `${f.title} (${f.severity})`).join('; ') || 'confirmed critical threat detected'}.`,
        explanation: hasCriticalSecurity
          ? `BLOCK — A confirmed critical security finding triggered the mandatory security stop: ${secResult.findings.filter(f => f.severity === 'critical' && f.is_confirmed).map(f => f.title).join('; ') || 'critical threat detected'}. Risk score ${secResult.riskScore}/100. The task is stopped before policy evaluation and cannot be overridden for execution.`
          : `BLOCK — Prompt-injection detection triggered the mandatory security stop: ${secResult.findings.filter(f => f.category === 'prompt_injection').map(f => f.title).join('; ') || 'high or critical prompt injection detected'}. Risk score ${secResult.riskScore}/100. The task is stopped before policy evaluation and cannot be overridden for execution.`,
        requires_review: false,
        review_reason: null,
        policy_version: '1.0.0',
        model_provider: null,
        model_id: null,
        model_version: null,
        is_simulated: true,
        raw_output: null,
      });

      store.addTaskEvent({
        task_id: taskId,
        event_type: 'decision_generated',
        previous_state: 'security_analysis',
        next_state: 'blocked',
        actor: 'system',
        service: 'pipeline',
        correlation_id: correlationId,
        details: { decision: 'BLOCK', reason: 'mandatory_security_block' },
      });
      return;
    }

    // Agent 3: Policy Evaluation & Decision
    await transitionState(taskId, 'risk_analysis', 'agent-3', 'pipeline', correlationId);
    await sleep(500); // Simulate risk analysis processing
    await transitionState(taskId, 'policy_check', 'agent-3', 'pipeline', correlationId);
    
    const policyResult = await runAgent3(task, docResult, secResult, correlationId);

    const { activeProvider } = getActiveAIProvider();
    const isLiveAI = activeProvider === 'gemini' || activeProvider === 'nemotron';
    const modelProvider = activeProvider === 'gemini' ? 'Google Gemini' : activeProvider === 'nemotron' ? 'NVIDIA Nemotron' : 'FinShield Heuristic Core';
    const modelId = activeProvider === 'gemini' ? GEMINI_MODEL_ID : activeProvider === 'nemotron' ? NEMOTRON_MODEL_ID : 'finshield-demo-evaluator';

    // Save evaluation result
    const evalResult = store.saveEvaluationResult({
      task_id: taskId,
      decision: policyResult.decision,
      risk_score: policyResult.riskScore,
      model_confidence: policyResult.modelConfidence,
      policy_checks: policyResult.policyChecks,
      security_findings_count: secResult.findings.length,
      policy_checks_passed: policyResult.policyChecks.filter(c => c.passed).length,
      policy_checks_failed: policyResult.policyChecks.filter(c => !c.passed).length,
      policy_checks_total: policyResult.policyChecks.length,
      evidence_summary: policyResult.evidenceSummary,
      explanation: policyResult.explanation,
      requires_review: policyResult.requiresReview,
      review_reason: policyResult.reviewReason,
      policy_version: '1.0.0',
      model_provider: modelProvider,
      model_id: modelId,
      model_version: '1.0.0',
      is_simulated: !isLiveAI,
      raw_output: null,
    });

    // Apply decision
    let finalState: TaskState;
    if (policyResult.decision === 'BLOCK') {
      finalState = 'blocked';
    } else if (policyResult.decision === 'VERIFY') {
      finalState = 'awaiting_review';
    } else {
      finalState = 'allowed';
    }

    store.updateTask(taskId, {
      state: finalState,
      decision: policyResult.decision,
      risk_score: policyResult.riskScore,
      model_confidence: policyResult.modelConfidence,
      completed_at: finalState === 'blocked' ? new Date().toISOString() : undefined,
    });

    store.addTaskEvent({
      task_id: taskId,
      event_type: 'decision_generated',
      previous_state: 'policy_check',
      next_state: finalState,
      actor: 'agent-3',
      service: 'pipeline',
      correlation_id: correlationId,
      details: {
        decision: policyResult.decision,
        riskScore: policyResult.riskScore,
        requiresReview: policyResult.requiresReview,
        reviewReason: policyResult.reviewReason,
        evaluationId: evalResult.id,
      },
    });

    if (policyResult.requiresReview) {
      store.addTaskEvent({
        task_id: taskId,
        event_type: 'marked_for_review',
        actor: 'system',
        service: 'pipeline',
        correlation_id: correlationId,
        details: { reason: policyResult.reviewReason },
      });
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown pipeline error';
    await failTask(taskId, msg, correlationId);
  } finally {
    activeTaskIds.delete(taskId);
    store.clearTaskDocumentText(taskId);
  }
}

// ─── State Transition Helper ────────────────────────────────────────

async function transitionState(
  taskId: string,
  newState: TaskState,
  actor: string,
  service: string,
  correlationId: string
): Promise<void> {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  if (!isValidTransition(task.state, newState)) {
    throw new Error(`Invalid state transition: ${task.state} → ${newState} for task ${taskId}`);
  }

  const previousState = task.state;
  store.updateTask(taskId, {
    state: newState,
    started_at: task.started_at ?? new Date().toISOString(),
  });

  store.addTaskEvent({
    task_id: taskId,
    event_type: 'state_transition',
    previous_state: previousState,
    next_state: newState,
    actor,
    service,
    correlation_id: correlationId,
  });

  // Small delay to make real-time updates visible
  await sleep(300);
}

async function failTask(taskId: string, errorMessage: string, correlationId: string): Promise<void> {
  store.updateTask(taskId, {
    state: 'failed',
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  });

  store.addTaskEvent({
    task_id: taskId,
    event_type: 'task_failed',
    actor: 'system',
    service: 'pipeline',
    correlation_id: correlationId,
    details: { error: errorMessage },
  });
}

// ─── Agent 1: Document Processing ───────────────────────────────────

async function runAgent1(
  task: Task,
  correlationId: string
): Promise<DocumentProcessingResult> {
  const startTime = Date.now();

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'extraction_started',
    actor: 'agent-1',
    service: 'pipeline',
    correlation_id: correlationId,
    details: { fileName: task.file_name, fileType: task.file_type },
  });

  // Simulate processing time
  await sleep(800 + Math.random() * 700);

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'file_validated',
    actor: 'agent-1',
    service: 'pipeline',
    correlation_id: correlationId,
    details: { valid: true, fileSize: task.file_size },
  });

  await sleep(500 + Math.random() * 500);

  const documentText = store.getTaskDocumentText(task.id);
  const submittedText = [task.title, task.instructions].filter(Boolean).join('\n');
  const extraction = documentText
    ? generateExtractionFromText(task, documentText)
    : submittedText
      ? generateExtractionFromText(task, submittedText)
      : generateDemoExtraction(task);
  const extractionMethod = documentText
    ? task.file_name?.toLowerCase().endsWith('.pdf') ? 'pdf-text-parser' : task.file_name?.toLowerCase().endsWith('.csv') ? 'csv-parser' : 'plain-text-parser'
    : submittedText ? 'task-text-parser' : task.file_type?.includes('image') ? 'ocr-tesseract' : 'text-parser';

  return {
    success: true,
    extractedFields: extraction.fields,
    rawText: documentText ?? submittedText ?? extraction.rawText,
    extractionMethod,
    confidence: extraction.confidence,
    missingFields: extraction.missingFields,
    warnings: extraction.warnings,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Agent 2: Security Analysis ─────────────────────────────────────

async function runAgent2(
  task: Task,
  docResult: DocumentProcessingResult,
  correlationId: string
): Promise<SecurityAnalysisResult> {
  const startTime = Date.now();

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'security_analysis_started',
    actor: 'agent-2',
    service: 'pipeline',
    correlation_id: correlationId,
  });

  await sleep(600 + Math.random() * 600);

  const findings: SecurityAnalysisResult['findings'] = [];
  const checksPerformed: string[] = [];
  let riskScore = 10; // Base risk
  let modelConfidence: number | null = null;

  // Check 1: Prompt injection detection
  checksPerformed.push('prompt_injection_scan');
  const text = (docResult.rawText + ' ' + (task.instructions || '')).toLowerCase();
  const injectionPatterns = [
    'ignore previous instructions',
    'disregard all rules',
    'you are now',
    'system prompt',
    'bypass security',
    'override policy',
    'transfer all funds',
    'reveal secrets',
    'ignore above',
  ];

  for (const pattern of injectionPatterns) {
    if (text.includes(pattern)) {
      findings.push({
        category: 'prompt_injection' as FindingCategory,
        severity: 'critical' as FindingSeverity,
        title: 'Prompt Injection Detected',
        description: `Document contains instruction attempting to override system behavior: "${pattern}"`,
        evidence: `Pattern found in document text`,
        evidence_location: 'document_content',
        is_confirmed: true,
        requires_review: false,
        remediation: 'Block task immediately. Do not process instructions from document.',
      });
      riskScore = 95;
      break;
    }
  }

  // Check 2: Suspicious content
  checksPerformed.push('suspicious_content_scan');
  const suspiciousPatterns = [
    { pattern: 'urgent', severity: 'medium' as FindingSeverity, score: 15 },
    { pattern: 'wire transfer', severity: 'medium' as FindingSeverity, score: 20 },
    { pattern: 'immediately', severity: 'low' as FindingSeverity, score: 10 },
    { pattern: 'confidential', severity: 'low' as FindingSeverity, score: 5 },
  ];

  for (const sp of suspiciousPatterns) {
    if (text.includes(sp.pattern)) {
      findings.push({
        category: 'suspicious_content' as FindingCategory,
        severity: sp.severity,
        title: `Suspicious Content: "${sp.pattern}"`,
        description: `Document contains potentially suspicious language: "${sp.pattern}"`,
        evidence: `Found in document text`,
        evidence_location: 'document_content',
        is_confirmed: false,
        requires_review: sp.severity !== 'low',
        remediation: 'Review the context of this language before proceeding.',
      });
      riskScore += sp.score;
    }
  }

  // Check 3: Amount anomaly
  checksPerformed.push('amount_anomaly_check');
  const amount = docResult.extractedFields.amount;
  if (amount && typeof amount === 'number') {
    if (amount > 50000) {
      findings.push({
        category: 'amount_anomaly' as FindingCategory,
        severity: 'high' as FindingSeverity,
        title: 'High Transaction Amount',
        description: `Transaction amount $${amount.toLocaleString()} exceeds typical threshold`,
        evidence: `Amount: ${amount}`,
        evidence_location: 'extracted_fields.amount',
        is_confirmed: true,
        requires_review: true,
        remediation: 'Verify the amount with the requester before proceeding.',
      });
      riskScore += 25;
    } else if (amount > 10000) {
      riskScore += 10;
    }
  }

  // Check 4: Missing information
  checksPerformed.push('missing_info_check');
  if (docResult.missingFields.length > 0) {
    const criticalMissing = docResult.missingFields.filter(f =>
      ['vendor_name', 'amount', 'invoice_number'].includes(f)
    );
    if (criticalMissing.length > 0) {
      findings.push({
        category: 'missing_information' as FindingCategory,
        severity: 'medium' as FindingSeverity,
        title: 'Missing Critical Fields',
        description: `Required fields not found in document: ${criticalMissing.join(', ')}`,
        evidence: `Missing: ${criticalMissing.join(', ')}`,
        evidence_location: 'extracted_fields',
        is_confirmed: true,
        requires_review: true,
        remediation: 'Obtain the missing information before processing.',
      });
      riskScore += 15;
    }
  }

  // Check 5: Vendor verification
  checksPerformed.push('vendor_verification');
  
  // Check 6: Duplicate invoice
  checksPerformed.push('duplicate_invoice_check');

  // Check 7: Deep Neural Inspection via Gemini / Nemotron (if configured)
  try {
    const aiResult = await runAISecurityInspection({
      taskType: task.type,
      documentText: docResult.rawText,
      instructions: task.instructions,
      extractedFields: docResult.extractedFields as Record<string, unknown>,
      fileName: task.file_name,
    });

    if (aiResult) {
      checksPerformed.push(`deep_ai_${aiResult.provider}`);
      modelConfidence = aiResult.confidence ?? null;
      if (aiResult.promptInjectionDetected) {
        findings.push({
          category: 'prompt_injection',
          severity: 'critical',
          title: `Prompt Injection Flagged by ${aiResult.provider === 'gemini' ? 'Google Gemini' : 'NVIDIA Nemotron'}`,
          description: aiResult.injectionDetails || 'Adversarial manipulation instruction detected by neural security classifier.',
          evidence: 'Identified by neural LLM inspection',
          evidence_location: 'document_content',
          is_confirmed: true,
          requires_review: false,
          remediation: 'Mandatory security block.',
        });
        riskScore = Math.max(riskScore, 95);
      }
      for (const f of aiResult.findings) {
        if (!findings.some(existing => existing.category === f.category && existing.severity === f.severity)) {
          findings.push({
            ...f,
            evidence_location: null,
            is_confirmed: false,
            requires_review: f.severity === 'high' || f.severity === 'critical',
          });
        }
      }
      riskScore = Math.max(riskScore, aiResult.riskScore);

      store.addTaskEvent({
        task_id: task.id,
        event_type: 'security_findings_recorded',
        actor: 'agent-2',
        service: aiResult.provider === 'gemini' ? 'Google Gemini' : 'NVIDIA Nemotron',
        correlation_id: correlationId,
        details: {
          aiModel: aiResult.modelId,
          aiProvider: aiResult.provider,
          latencyMs: aiResult.latencyMs,
          promptInjection: aiResult.promptInjectionDetected,
          modelConfidence,
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI provider inspection failed';
    store.addTaskEvent({
      task_id: task.id,
      event_type: 'error',
      actor: 'agent-2',
      service: 'pipeline',
      correlation_id: correlationId,
      details: { stage: 'security_analysis', error: message },
    });
    throw new Error(`Mandatory security analysis failed: ${message}`);
  }

  const overallThreatLevel: FindingSeverity =
    riskScore >= 80 ? 'critical' :
    riskScore >= 60 ? 'high' :
    riskScore >= 30 ? 'medium' : 'low';

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'security_analysis_completed',
    actor: 'agent-2',
    service: 'pipeline',
    correlation_id: correlationId,
    details: {
      findingsCount: findings.length,
      riskScore,
      threatLevel: overallThreatLevel,
    },
  });

  return {
    success: true,
    findings,
    riskScore: Math.min(riskScore, 100),
    overallThreatLevel,
    checksPerformed,
    modelConfidence,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Agent 3: Policy Evaluation & Decision ──────────────────────────

async function runAgent3(
  task: Task,
  docResult: DocumentProcessingResult,
  secResult: SecurityAnalysisResult,
  correlationId: string
): Promise<PolicyEvaluationResult> {
  const startTime = Date.now();

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'policy_check_started',
    actor: 'agent-3',
    service: 'pipeline',
    correlation_id: correlationId,
  });

  await sleep(500 + Math.random() * 500);

  const activePolicies = store.getActivePolicyRules();
  const policyChecks: PolicyCheckResult[] = [];
  let shouldBlock = false;
  let shouldVerify = false;
  let reviewReason: string | null = null;

  // Evaluate each active policy
  for (const policy of activePolicies) {
    const check = evaluatePolicy(policy, task, docResult, secResult);
    policyChecks.push(check);

    if (!check.passed) {
      if (policy.action === 'block') {
        shouldBlock = true;
      } else if (policy.action === 'verify') {
        shouldVerify = true;
        reviewReason = reviewReason || check.details;
      }
    }
  }

  // Calculate final risk score (combine security + policy)
  const policyFailCount = policyChecks.filter(c => !c.passed).length;
  let finalRiskScore = secResult.riskScore + (policyFailCount * 10);
  finalRiskScore = Math.min(finalRiskScore, 100);

  // Determine decision with strict precedence
  let decision: Decision;
  if (shouldBlock || finalRiskScore >= 85) {
    decision = 'BLOCK';
  } else if (shouldVerify || finalRiskScore >= 50) {
    decision = 'VERIFY';
    reviewReason = reviewReason || 'Elevated risk score requires human review';
  } else {
    decision = 'ALLOW';
  }

  // Generate explanation
  const explanation = generateExplanation(decision, policyChecks, secResult, finalRiskScore);
  const evidenceSummary = generateEvidenceSummary(policyChecks, secResult);

  store.addTaskEvent({
    task_id: task.id,
    event_type: 'policy_check_completed',
    actor: 'agent-3',
    service: 'pipeline',
    correlation_id: correlationId,
    details: {
      policiesEvaluated: policyChecks.length,
      passed: policyChecks.filter(c => c.passed).length,
      failed: policyChecks.filter(c => !c.passed).length,
    },
  });

  return {
    success: true,
    decision,
    riskScore: finalRiskScore,
    modelConfidence: secResult.modelConfidence,
    policyChecks,
    explanation,
    requiresReview: decision === 'VERIFY',
    reviewReason,
    evidenceSummary,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── Policy Evaluation Helpers ──────────────────────────────────────

function evaluatePolicy(
  policy: ReturnType<typeof store.getActivePolicyRules>[0],
  task: Task,
  docResult: DocumentProcessingResult,
  secResult: SecurityAnalysisResult
): PolicyCheckResult {
  const conditions = policy.conditions as Record<string, unknown>;

  switch (policy.category) {
    case 'amount_limits': {
      const threshold = (conditions.amount_threshold as number) || 10000;
      const amount = docResult.extractedFields.amount;
      const passed = !amount || (typeof amount === 'number' && amount <= threshold);
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed,
        details: passed
          ? `Amount ${amount ? `$${amount}` : 'N/A'} within limit $${threshold}`
          : `Amount $${amount} exceeds limit $${threshold}`,
        evidence: `threshold=${threshold}, amount=${amount}`,
      };
    }

    case 'vendor_security': {
      // In demo mode, vendor changes are flagged via security findings
      const hasVendorIssue = secResult.findings.some(f => f.category === 'vendor_mismatch');
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed: !hasVendorIssue,
        details: hasVendorIssue
          ? 'Vendor bank detail change detected — requires verification'
          : 'No vendor detail changes detected',
        evidence: null,
      };
    }

    case 'security': {
      const findingCategory = conditions.finding_category as string;
      const minSeverity = conditions.min_severity as string;
      const relevantFindings = secResult.findings.filter(
        f => f.category === findingCategory &&
          severityLevel(f.severity) >= severityLevel(minSeverity as FindingSeverity)
      );
      const passed = relevantFindings.length === 0;
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed,
        details: passed
          ? `No ${findingCategory} findings at ${minSeverity} or above`
          : `${relevantFindings.length} ${findingCategory} finding(s) at ${minSeverity} or above`,
        evidence: relevantFindings.length > 0 ? relevantFindings[0].title : null,
      };
    }

    case 'fraud_detection': {
      const hasDuplicate = secResult.findings.some(f => f.category === 'duplicate_invoice');
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed: !hasDuplicate,
        details: hasDuplicate
          ? 'Potential duplicate invoice detected'
          : 'No duplicate invoices detected',
        evidence: null,
      };
    }

    case 'data_quality': {
      const requiredFields = (conditions.required_fields as string[]) || [];
      const missingRequired = requiredFields.filter(f =>
        docResult.missingFields.includes(f)
      );
      const passed = missingRequired.length === 0;
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed,
        details: passed
          ? 'All required fields present'
          : `Missing required fields: ${missingRequired.join(', ')}`,
        evidence: missingRequired.length > 0 ? `missing=${missingRequired.join(',')}` : null,
      };
    }

    case 'risk_management': {
      const threshold = (conditions.risk_score_threshold as number) || 85;
      const passed = secResult.riskScore < threshold;
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed,
        details: passed
          ? `Risk score ${secResult.riskScore} below threshold ${threshold}`
          : `Risk score ${secResult.riskScore} exceeds threshold ${threshold}`,
        evidence: `score=${secResult.riskScore}, threshold=${threshold}`,
      };
    }

    default:
      return {
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action,
        passed: true,
        details: 'Policy category not evaluated in current version',
        evidence: null,
      };
  }
}

function severityLevel(severity: FindingSeverity): number {
  const levels: Record<FindingSeverity, number> = {
    info: 0, low: 1, medium: 2, high: 3, critical: 4,
  };
  return levels[severity] ?? 0;
}

function generateExplanation(
  decision: Decision,
  checks: PolicyCheckResult[],
  secResult: SecurityAnalysisResult,
  riskScore: number
): string {
  const passed = checks.filter((check) => check.passed).length;
  const failedChecks = checks.filter((check) => !check.passed);
  const blockRules = failedChecks.filter((check) => check.action === 'block');
  const verifyRules = failedChecks.filter((check) => check.action === 'verify');
  const flaggedRules = failedChecks.filter((check) => check.action === 'flag');
  const unboundedRiskScore = secResult.riskScore + (failedChecks.length * 10);
  const riskCalculation = `${secResult.riskScore} security risk + ${failedChecks.length} failed policy check(s) × 10 = ${unboundedRiskScore}, capped at ${riskScore}/100`;
  const securitySummary = secResult.findings.length
    ? `${secResult.findings.length} security finding(s): ${secResult.findings.slice(0, 3).map((finding) => `${finding.title} (${finding.severity})`).join('; ')}${secResult.findings.length > 3 ? '; additional findings recorded' : ''}.`
    : 'No security findings were recorded.';
  const policySummary = failedChecks.length
    ? failedChecks.map((check) => `${check.policyName}: ${check.details} [${check.action.toUpperCase()} rule]`).join('; ')
    : `${passed} of ${checks.length} policy checks passed.`;

  switch (decision) {
    case 'ALLOW':
      return `ALLOW — The task may proceed because no BLOCK or VERIFY policy was triggered, all ${checks.length} policy checks passed, and the final risk score ${riskScore}/100 is below the VERIFY threshold of 50. ${securitySummary} ${riskCalculation}.`;
    case 'BLOCK': {
      const reason = blockRules.length
        ? `Blocking policy triggered: ${blockRules.map((check) => `${check.policyName} — ${check.details}`).join('; ')}.`
        : `Final risk score ${riskScore}/100 reached the automatic BLOCK threshold of 85.`;
      return `BLOCK — Execution is prohibited. ${reason} ${policySummary} ${securitySummary} ${riskCalculation}.`;
    }
    case 'VERIFY': {
      const reasons = [
        ...verifyRules.map((check) => `${check.policyName} — ${check.details}`),
        ...(riskScore >= 50 ? [`Final risk score ${riskScore}/100 reached the human-review threshold of 50.`] : []),
        ...flaggedRules.map((check) => `${check.policyName} — ${check.details} (flagged for risk scoring).`),
      ];
      return `VERIFY — Execution is paused until an authorized reviewer decides. ${reasons.join(' ')} ${policySummary} ${securitySummary} ${riskCalculation}.`;
    }
  }
}

function generateEvidenceSummary(
  checks: PolicyCheckResult[],
  secResult: SecurityAnalysisResult
): string {
  const parts: string[] = [];
  parts.push(`${checks.length} policies evaluated`);
  parts.push(`${secResult.findings.length} security findings`);
  parts.push(`${secResult.checksPerformed.length} security checks performed`);
  if (checks.some(c => !c.passed)) {
    parts.push(`Failed: ${checks.filter(c => !c.passed).map(c => c.policyName).join(', ')}`);
  }
  return parts.join('. ') + '.';
}

// ─── Demo Data Generation ───────────────────────────────────────────

function generateExtractionFromText(task: Task, rawText: string) {
  const field = (pattern: RegExp) => rawText.match(pattern)?.[1]?.trim() || null;
  const csvRows = task.file_name?.toLowerCase().endsWith('.csv') ? parseCsvRows(rawText) : [];
  const headers = (csvRows[0] || []).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const csvValue = (...aliases: string[]) => {
    const index = headers.findIndex((header) => aliases.includes(header));
    return index >= 0 ? csvRows.slice(1).map((row) => row[index]?.trim()).find(Boolean) || null : null;
  };
  const invoiceNumber = csvValue('invoice number', 'invoice no', 'invoice id', 'invoice');
  const vendorName = csvValue('vendor', 'vendor name', 'supplier', 'supplier name', 'payee');
  const csvAmount = csvValue('amount', 'total', 'invoice total', 'grand total');
  const amountText = csvAmount || rawText.match(/(?:total|amount|grand\s+total|invoice\s+total)\s*[:=]?\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const amount = amountText ? Number(amountText.replace(/[^\d.-]/g, '')) : null;
  const currency = csvValue('currency')?.toUpperCase() || rawText.match(/\b(USD|EUR|GBP|CAD|AUD)\b/i)?.[1]?.toUpperCase() || (amountText?.includes('$') ? 'USD' : null);
  const fields: Partial<import('@/lib/types').ExtractedFields> = {
    invoice_number: invoiceNumber || field(/(?:invoice\s*(?:number|no\.?|#)|invoice_number)\s*[:#=]\s*([^\r\n]+)/i),
    vendor_name: vendorName || field(/(?:vendor(?:\s*name)?|supplier(?:\s*name)?)\s*[:=]\s*([^\r\n]+)/i),
    vendor_id: csvValue('vendor id') || field(/vendor\s*(?:id|number)\s*[:=]\s*([^\r\n]+)/i),
    invoice_date: csvValue('invoice date', 'date') || field(/invoice\s*date\s*[:=]\s*([^\r\n]+)/i),
    due_date: csvValue('due date') || field(/due\s*date\s*[:=]\s*([^\r\n]+)/i),
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency,
    account_number: csvValue('account number', 'account no', 'account') || field(/account\s*(?:number|no\.?|#)\s*[:=]\s*([^\r\n]+)/i),
    bank_details: csvValue('bank details', 'routing number', 'iban') || field(/(?:bank\s*details|routing\s*(?:number|no\.?)|iban)\s*[:=]\s*([^\r\n]+)/i),
    description: csvValue('description') || field(/description\s*[:=]\s*([^\r\n]+)/i),
    requested_action: task.type,
  };
  const requiredFields: Partial<Record<TaskType, (keyof typeof fields)[]>> = {
    invoice_verification: ['invoice_number', 'vendor_name', 'amount'],
    vendor_verification: ['vendor_name', 'bank_details'],
    payment_preparation: ['vendor_name', 'amount', 'account_number'],
    account_reconciliation: ['account_number', 'amount'],
  };
  const missingFields = (requiredFields[task.type] || []).filter((name) => !fields[name]);

  return {
    fields,
    rawText,
    confidence: {},
    missingFields,
    warnings: missingFields.length ? ['Some task fields could not be extracted from the uploaded document.'] : [],
  };
}

function generateDemoExtraction(task: Task) {
  const demoData: Record<TaskType, {
    fields: Record<string, unknown>;
    rawText: string;
    confidence: Record<string, number>;
    missingFields: string[];
    warnings: string[];
  }> = {
    invoice_verification: {
      fields: {
        invoice_number: `INV-${2024000 + Math.floor(Math.random() * 1000)}`,
        vendor_name: ['Acme Corp', 'TechFlow Solutions', 'DataPrime LLC', 'CloudServ Inc'][Math.floor(Math.random() * 4)],
        vendor_id: `VND-${100 + Math.floor(Math.random() * 900)}`,
        invoice_date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0],
        due_date: new Date(Date.now() + Math.random() * 30 * 86400000).toISOString().split('T')[0],
        amount: Math.round((500 + Math.random() * 25000) * 100) / 100,
        currency: 'USD',
        description: 'Professional services and consulting',
        requested_action: 'process_payment',
      },
      rawText: 'INVOICE\nInvoice Number: INV-2024XXX\nVendor: Acme Corp\nAmount: $X,XXX.XX\nDue Date: XX/XX/XXXX\nDescription: Professional services',
      confidence: { invoice_number: 0.95, vendor_name: 0.92, amount: 0.98, date: 0.90 },
      missingFields: [],
      warnings: [],
    },
    vendor_verification: {
      fields: {
        vendor_name: 'TechFlow Solutions',
        vendor_id: 'VND-201',
        bank_details: 'XXXX-XXXX-XXXX-1234',
        account_number: '****1234',
        description: 'Vendor registration update',
        requested_action: 'verify_vendor',
      },
      rawText: 'VENDOR UPDATE FORM\nVendor: TechFlow Solutions\nBank: XXXX-XXXX-XXXX-1234\nAccount: ****1234',
      confidence: { vendor_name: 0.94, bank_details: 0.88, account_number: 0.91 },
      missingFields: ['amount'],
      warnings: [],
    },
    payment_preparation: {
      fields: {
        invoice_number: `PAY-${2024000 + Math.floor(Math.random() * 1000)}`,
        vendor_name: 'DataPrime LLC',
        amount: Math.round((1000 + Math.random() * 50000) * 100) / 100,
        currency: 'USD',
        account_number: '****5678',
        bank_details: 'ROUTING-XXX-XXX',
        requested_action: 'prepare_payment',
        description: 'Monthly service payment',
      },
      rawText: 'PAYMENT REQUEST\nPayee: DataPrime LLC\nAmount: $XX,XXX.XX\nAccount: ****5678',
      confidence: { vendor_name: 0.96, amount: 0.99, account_number: 0.93 },
      missingFields: [],
      warnings: [],
    },
    account_reconciliation: {
      fields: {
        account_number: '****9012',
        amount: Math.round((100 + Math.random() * 5000) * 100) / 100,
        currency: 'USD',
        description: 'Monthly reconciliation report',
        requested_action: 'reconcile',
      },
      rawText: 'RECONCILIATION REPORT\nAccount: ****9012\nPeriod: October 2024\nDiscrepancy: $XXX.XX',
      confidence: { account_number: 0.97, amount: 0.95 },
      missingFields: ['vendor_name', 'invoice_number'],
      warnings: ['Reconciliation may have discrepancies'],
    },
    document_review: {
      fields: {
        description: 'General document for review',
        requested_action: 'review',
      },
      rawText: 'Document content for review...',
      confidence: {},
      missingFields: ['vendor_name', 'amount', 'invoice_number'],
      warnings: ['Limited fields extracted from general document'],
    },
  };

  const data = demoData[task.type] || demoData.document_review;

  // Add task-specific instructions influence
  if (task.instructions) {
    data.rawText += `\n\nTask Instructions: ${task.instructions}`;
  }

  return data;
}

// ─── Sandbox Execution ──────────────────────────────────────────────

export async function executeSandboxTask(taskId: string): Promise<SandboxExecution | null> {
  const task = store.getTask(taskId);
  if (!task) return null;

  if (task.state === 'blocked' || task.decision === 'BLOCK') {
    throw new Error('BLOCKED tasks cannot execute. This is a mandatory security constraint.');
  }

  if (task.state !== 'allowed') {
    throw new Error('Only tasks in the allowed state can execute.');
  }

  if (task.decision === 'VERIFY') {
    const reviews = store.getHumanReviews(taskId);
    const approved = reviews.find(r => r.decision === 'approved');
    if (!approved) {
      throw new Error('VERIFY tasks require approved human review before execution.');
    }
  }

  if (task.decision !== 'ALLOW' && task.decision !== 'VERIFY') {
    throw new Error(`Task decision "${task.decision}" does not permit execution.`);
  }

  const correlationId = generateCorrelationId();
  const idempotencyKey = `exec-${taskId}`;

  // Check idempotency
  const existing = store.getSandboxExecution(taskId);
  if (existing && existing.status === 'completed') {
    return existing; // Already executed — return existing result
  }
  if (existing && existing.status !== 'failed') {
    throw new Error('An execution for this task already exists or is in progress.');
  }

  const evalResult = store.getEvaluationResult(taskId);
  if (!evalResult) {
    throw new Error('A persisted evaluation is required before sandbox execution.');
  }

  const execution = store.createSandboxExecution({
    task_id: taskId,
    operation_type: task.type,
    operation_details: {
      taskNumber: task.task_number,
      type: task.type,
      decision: task.decision,
      riskScore: task.risk_score,
    },
    authorization_ref: evalResult?.id || 'direct-authorization',
    idempotency_key: idempotencyKey,
    status: 'executing',
    mock_reference_id: `MOCK-${Date.now().toString(36).toUpperCase()}`,
    result: null,
    error_message: null,
    executed_by: 'sandbox-executor',
    started_at: new Date().toISOString(),
    completed_at: null,
  });

  store.updateTask(taskId, { state: 'executing' });

  store.addTaskEvent({
    task_id: taskId,
    event_type: 'execution_started',
    actor: 'sandbox-executor',
    service: 'bank-agent',
    correlation_id: correlationId,
    details: { executionId: execution.id, mockRefId: execution.mock_reference_id },
  });

  // Simulate execution
  await sleep(1000 + Math.random() * 1000);

  const result = generateMockExecutionResult(task);

  store.updateSandboxExecution(execution.id, {
    status: 'completed',
    result,
    completed_at: new Date().toISOString(),
  });

  store.updateTask(taskId, {
    state: 'completed',
    completed_at: new Date().toISOString(),
  });

  store.addTaskEvent({
    task_id: taskId,
    event_type: 'execution_completed',
    actor: 'sandbox-executor',
    service: 'bank-agent',
    correlation_id: correlationId,
    details: {
      executionId: execution.id,
      result,
      mockRefId: execution.mock_reference_id,
    },
  });

  return store.getSandboxExecution(taskId);
}

function generateMockExecutionResult(task: Task): Record<string, unknown> {
  const fields = store.getExtractedFields(task.id);

  switch (task.type) {
    case 'invoice_verification':
      return {
        status: 'verified',
        invoiceNumber: fields?.invoice_number || 'N/A',
        vendorVerified: true,
        amountConfirmed: true,
        processedAmount: fields?.amount || 0,
        message: 'Invoice verified and approved for payment processing',
      };
    case 'vendor_verification':
      return {
        status: 'verified',
        vendorName: fields?.vendor_name || 'N/A',
        vendorId: fields?.vendor_id || 'N/A',
        detailsConfirmed: true,
        message: 'Vendor details verified against records',
      };
    case 'payment_preparation':
      return {
        status: 'prepared',
        paymentRef: `PAY-${Date.now().toString(36).toUpperCase()}`,
        amount: fields?.amount || 0,
        currency: fields?.currency || 'USD',
        beneficiary: fields?.vendor_name || 'N/A',
        message: 'Payment prepared for authorization (sandbox — not a real transaction)',
      };
    case 'account_reconciliation':
      return {
        status: 'reconciled',
        accountRef: fields?.account_number || 'N/A',
        discrepancies: 0,
        matchRate: '99.8%',
        message: 'Account reconciliation completed',
      };
    default:
      return {
        status: 'processed',
        message: 'Document processed in sandbox environment',
      };
  }
}
