'use client';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Banknote,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileCheck2,
  FileClock,
  FileDown,
  FileSearch,
  FileUp,
  History,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  type DashboardMetrics,
  type EvaluationResult,
  type ExtractedFields,
  type HumanReview,
  type PolicyRule,
  type SandboxExecution,
  type SecurityFinding,
  type Task,
  type TaskEvent,
} from '@/lib/types';

type Workspace = 'Overview' | 'Allocate Task' | 'FinShield AI' | 'Bank Agent' | 'History' | 'Settings';
type ApiEnvelope<T> = { success: boolean; data?: T; error?: string; message?: string };
type TaskDetail = {
  task: Task;
  events: TaskEvent[];
  extractedFields: ExtractedFields | null;
  securityFindings: SecurityFinding[];
  evaluationResult: EvaluationResult | null;
  humanReviews: HumanReview[];
  sandboxExecution: SandboxExecution | null;
  convertedCsv: string | null;
};
type ProviderStatus = {
  activeProvider: 'gemini' | 'nemotron' | 'unavailable';
  hasGemini: boolean;
  hasNemotron: boolean;
  requestTimeoutMs: number;
};

const NAVIGATION: { label: Workspace; icon: LucideIcon }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Allocate Task', icon: FileUp },
  { label: 'FinShield AI', icon: ShieldCheck },
  { label: 'Bank Agent', icon: Banknote },
  { label: 'History', icon: History },
];

const EMPTY_METRICS: DashboardMetrics = {
  totalToday: 0,
  allowedToday: 0,
  blockedToday: 0,
  verifyToday: 0,
  pendingTasks: 0,
  processing: 0,
  highRiskAlerts: 0,
  pendingReviews: 0,
  avgProcessingMs: 0,
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload.data as T;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDuration(milliseconds: number | null | undefined) {
  if (!milliseconds || milliseconds < 0) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function outcomeFor(task: Task) {
  if (task.decision === 'ALLOW') return 'ALLOW';
  if (task.decision === 'BLOCK') return 'BLOCK';
  if (task.decision === 'VERIFY' || task.state === 'awaiting_review') return 'VERIFY';
  return task.state;
}

function outcomeClass(value: string) {
  if (value === 'ALLOW' || value === 'allowed' || value === 'completed') return 'status status-allow';
  if (value === 'BLOCK' || value === 'blocked' || value === 'failed') return 'status status-block';
  if (value === 'VERIFY' || value === 'awaiting_review') return 'status status-verify';
  return 'status status-neutral';
}

function fileMimeAllowed(file: File) {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  return ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number]);
}

function getIconForDecision(decision: string): LucideIcon {
  if (decision === 'ALLOW') return ShieldCheck;
  if (decision === 'BLOCK') return ShieldX;
  if (decision === 'VERIFY') return ShieldAlert;
  return Activity;
}

export default function Home() {
  const [hasStarted, setHasStarted] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>('Overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const [queueFilter, setQueueFilter] = useState<'all' | 'pending'>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]>('invoice_verification');
  const [taskTitle, setTaskTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [reviewReason, setReviewReason] = useState('');
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const submissionKey = useRef<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const [taskData, metricData, policyData, aiData] = await Promise.all([
        apiRequest<Task[]>('/api/tasks?page=1&pageSize=100'),
        apiRequest<DashboardMetrics & { totalAllTime?: number }>('/api/metrics'),
        apiRequest<PolicyRule[]>('/api/policies'),
        apiRequest<ProviderStatus>('/api/ai-config'),
      ]);
      setTasks(taskData);
      setMetrics(metricData);
      setPolicies(policyData);
      setProviderStatus(aiData);
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : 'Could not load dashboard data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasStarted) return;
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [hasStarted, refresh]);

  useEffect(() => {
    if (!hasStarted) return;
    const taskId = selectedDetail?.task.id;
    if (!taskId) return;
    const timer = window.setInterval(() => {
      void apiRequest<TaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`)
        .then((detail) => setSelectedDetail((current) => current?.task.id === taskId ? detail : current))
        .catch((error: unknown) => {
          setSelectedDetail((current) => current?.task.id === taskId ? null : current);
          toast.error(error instanceof Error ? error.message : 'Selected task is no longer available.');
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasStarted, selectedDetail?.task.id]);

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesSearch = !query
        || task.task_number.toLowerCase().includes(query)
        || task.title.toLowerCase().includes(query)
        || (task.file_name || '').toLowerCase().includes(query);
      const decision = outcomeFor(task);
      const matchesDecision = decisionFilter === 'all' || decision === decisionFilter;
      const matchesType = typeFilter === 'all' || task.type === typeFilter;
      const matchesQueue = queueFilter === 'all' || ['submitted', 'queued', 'validating', 'extracting', 'security_analysis', 'risk_analysis', 'policy_check'].includes(task.state);
      return matchesSearch && matchesDecision && matchesType && matchesQueue;
    });
  }, [tasks, searchQuery, decisionFilter, typeFilter, queueFilter]);

  async function openTask(task: Task) {
    try {
      let detail: TaskDetail;
      try {
        detail = await apiRequest<TaskDetail>(`/api/tasks/${encodeURIComponent(task.task_number)}`);
      } catch {
        detail = await apiRequest<TaskDetail>(`/api/tasks/${encodeURIComponent(task.id)}`);
      }
      setSelectedDetail(detail);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load task details.');
    }
  }

  async function loadDemoData() {
    try {
      await apiRequest('/api/demo/seed', { method: 'POST' });
      await refresh(true);
      toast.success('Synthetic sandbox data loaded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load sample data.');
    }
  }

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.some((file) => !fileMimeAllowed(file))) {
      toast.error('Choose text-based PDF, CSV, or TXT files only.');
      return;
    }
    if (selectedFiles.some((file) => file.size > MAX_FILE_SIZE)) {
      toast.error('Each file must be 10 MB or smaller.');
      return;
    }
    if (selectedFiles.length > 8) {
      toast.error('Upload up to 8 files in one batch.');
      return;
    }
    setIsSubmitting(true);
    try {
      const headers = { 'Idempotency-Key': submissionKey.current || (submissionKey.current = crypto.randomUUID()) };
      const title = taskTitle.trim() || TASK_TYPE_LABELS[taskType];
      let submittedTasks: Task[];
      if (selectedFiles.length) {
        const formData = new FormData();
        formData.set('type', taskType);
        formData.set('title', title);
        formData.set('instructions', instructions.trim());
        formData.set('reference_id', referenceId.trim());
        selectedFiles.forEach((file) => formData.append('files', file, file.name));
        submittedTasks = await apiRequest<Task[]>('/api/tasks', { method: 'POST', headers, body: formData });
      } else {
        const task = await apiRequest<Task>('/api/tasks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: taskType,
            title,
            instructions: instructions.trim() || null,
            reference_id: referenceId.trim() || null,
          }),
        });
        submittedTasks = [task];
      }
      setTaskTitle('');
      setInstructions('');
      setReferenceId('');
      setSelectedFiles([]);
      submissionKey.current = null;
      await refresh(true);
      setWorkspace('FinShield AI');
      await openTask(submittedTasks[0]);
      toast.success(`${submittedTasks.length} task${submittedTasks.length === 1 ? '' : 's'} queued: ${submittedTasks.map((task) => task.task_number).join(', ')}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Task submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitReview(decision: 'approved' | 'rejected' | 'info_requested') {
    if (!selectedDetail) return;
    try {
      await apiRequest(`/api/tasks/${encodeURIComponent(selectedDetail.task.id)}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: reviewReason.trim() }),
      });
      setReviewReason('');
      await refresh(true);
      await openTask(selectedDetail.task);
      toast.success(`Review recorded: ${humanize(decision)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Review could not be recorded.');
    }
  }

  async function executeTask(task: Task) {
    try {
      await apiRequest(`/api/tasks/${encodeURIComponent(task.id)}/execute`, { method: 'POST' });
      await refresh(true);
      await openTask(task);
      toast.success('Sandbox execution completed. No real funds were moved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sandbox execution failed.');
    }
  }

  async function togglePolicy(policy: PolicyRule) {
    try {
      await apiRequest('/api/policies', {
        method: 'POST',
        body: JSON.stringify({ id: policy.id, is_active: !policy.is_active }),
      });
      await refresh(true);
      toast.success(`Policy ${policy.is_active ? 'paused' : 'activated'}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Policy update failed.');
    }
  }

  async function testProvider(provider: 'gemini' | 'nemotron') {
    setIsTestingProvider(true);
    try {
      const result = await apiRequest<{
        success: boolean;
        message: string;
        latencyMs: number;
        model: string;
      }>('/api/ai-config', {
        method: 'POST',
        body: JSON.stringify({ action: 'test_key', provider }),
      });
      if (result.success) toast.success(`${result.message} (${result.latencyMs} ms)`);
      else toast.error(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Provider connection test failed.');
    } finally {
      setIsTestingProvider(false);
    }
  }

  function changeWorkspace(next: Workspace) {
    setWorkspace(next);
    setMobileNavOpen(false);
  }

  if (!hasStarted) {
    return <StartScreen onStart={() => setHasStarted(true)} />;
  }

  const reviewQueue = tasks.filter((task) => task.state === 'awaiting_review');
  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileNavOpen ? 'sidebar-mobile-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><ShieldCheck size={19} strokeWidth={2.4} /></div>
          {!sidebarCollapsed && <div className="brand-name">finshield<span> / AI</span></div>}
          <button className="icon-button sidebar-collapse" aria-label="Collapse navigation" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="nav-caption">{sidebarCollapsed ? '' : 'WORKSPACE'}</div>
        <nav className="nav-list" aria-label="Main navigation">
          {NAVIGATION.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-link ${workspace === label ? 'nav-link-active' : ''}`} onClick={() => changeWorkspace(label)} title={sidebarCollapsed ? label : undefined}>
              <Icon size={18} strokeWidth={1.8} />
              {!sidebarCollapsed && <span>{label}</span>}
              {!sidebarCollapsed && label === 'FinShield AI' && reviewQueue.length > 0 && <span className="nav-count">{reviewQueue.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="nav-caption">{sidebarCollapsed ? '' : 'PREFERENCES'}</div>
          <button className={`nav-link ${workspace === 'Settings' ? 'nav-link-active' : ''}`} onClick={() => changeWorkspace('Settings')} title={sidebarCollapsed ? 'Settings' : undefined}>
            <Settings2 size={18} strokeWidth={1.8} />{!sidebarCollapsed && <span>Settings & policies</span>}
          </button>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
            <div className="breadcrumb"><span>FinShield</span><ChevronRight size={14} /><strong>{workspace}</strong></div>
          </div>
          <div className="topbar-actions">
            <button className={`icon-button refresh-button ${isRefreshing ? 'is-spinning' : ''}`} aria-label="Refresh data" onClick={() => void refresh()}><RefreshCw size={16} /></button>
          </div>
        </header>

        <div className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">BANKING OPERATIONS · SECURITY CONTROL</div>
              <h1>{workspace}</h1>
              <p>{workspaceDescription(workspace)}</p>
            </div>
            {workspace !== 'Settings' && <button className="button button-primary" onClick={() => changeWorkspace('Allocate Task')}><FileUp size={16} /> Allocate task</button>}
          </div>

          {workspace === 'Overview' && (
            <Overview
              metrics={metrics}
              tasks={tasks}
              isLoading={isLoading}
              onOpenTask={openTask}
              onNavigate={changeWorkspace}
              onShowPendingTasks={() => {
                setQueueFilter('pending');
                setDecisionFilter('all');
                setTypeFilter('all');
                setSearchQuery('');
                changeWorkspace('FinShield AI');
              }}
              onLoadDemo={loadDemoData}
            />
          )}
          {workspace === 'Allocate Task' && (
            <AllocateTask
              taskType={taskType}
              setTaskType={setTaskType}
              taskTitle={taskTitle}
              setTaskTitle={setTaskTitle}
              instructions={instructions}
              setInstructions={setInstructions}
              referenceId={referenceId}
              setReferenceId={setReferenceId}
              selectedFiles={selectedFiles}
              setSelectedFiles={setSelectedFiles}
              isSubmitting={isSubmitting}
              onSubmit={submitTask}
              tasks={tasks}
              onOpenTask={openTask}
            />
          )}
          {workspace === 'FinShield AI' && (
            <FinShieldWorkspace
              tasks={visibleTasks}
              detail={selectedDetail}
              isLoading={isLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              decisionFilter={decisionFilter}
              setDecisionFilter={setDecisionFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              queueFilter={queueFilter}
              setQueueFilter={setQueueFilter}
              reviewReason={reviewReason}
              setReviewReason={setReviewReason}
              onCloseDetail={() => setSelectedDetail(null)}
              onOpenTask={openTask}
              onReview={submitReview}
              onExecute={executeTask}
              onLoadDemo={loadDemoData}
            />
          )}
          {workspace === 'Bank Agent' && (
            <BankAgentWorkspace
              tasks={tasks}
              onOpenTask={openTask}
              onExecute={executeTask}
              onLoadDemo={loadDemoData}
            />
          )}
          {workspace === 'History' && (
            <HistoryWorkspace
              tasks={visibleTasks}
              isLoading={isLoading}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              decisionFilter={decisionFilter}
              setDecisionFilter={setDecisionFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              onOpenTask={openTask}
              onLoadDemo={loadDemoData}
            />
          )}
          {workspace === 'Settings' && (
            <SettingsWorkspace
              policies={policies}
              providerStatus={providerStatus}
              isTestingProvider={isTestingProvider}
              onTogglePolicy={togglePolicy}
              onTestProvider={testProvider}
            />
          )}

          {selectedDetail && workspace !== 'FinShield AI' && (
            <TaskDetailPanel detail={selectedDetail} onClose={() => setSelectedDetail(null)} />
          )}
          <footer className="page-footer">
            <span><LockKeyhole size={13} /> Synthetic data only. No real banking connections.</span>
            <span>FinShield AI · Governance sandbox</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="start-screen">
      <aside className="start-rail" aria-hidden="true">
        <div className="start-rail-brand"><div className="brand-mark"><ShieldCheck size={19} strokeWidth={2.4} /></div><strong>finshield<span> / AI</span></strong></div>
        <div className="start-rail-label">SECURITY GOVERNANCE</div>
        <div className="start-rail-step start-rail-step-active"><ShieldCheck size={16} /> Secure workflow review</div>
        <div className="start-rail-step"><FileCheck2 size={16} /> Policy-controlled actions</div>
        <div className="start-rail-step"><UserRound size={16} /> Human approval gates</div>
        <div className="start-rail-footer"><i /> SANDBOX ENVIRONMENT</div>
      </aside>
      <section className="start-main" aria-labelledby="start-title">
        <header className="start-topbar"><span>FinShield</span><span>Banking security control</span></header>
        <div className="start-card">
          <div className="start-mark"><ShieldCheck size={28} strokeWidth={2.2} /></div>
          <p className="start-eyebrow">READY TO BEGIN</p>
          <h1 id="start-title">Secure every<br />banking workflow.</h1>
          <p>Evaluate requests with security signals, governed AI analysis, policy checks, and human review before sandbox execution.</p>
          <button className="button button-primary start-button" type="button" onClick={onStart}>
            Start <ArrowRight size={16} aria-hidden="true" />
          </button>
          <small><LockKeyhole size={13} /> Synthetic data only · no real banking connections</small>
        </div>
      </section>
    </main>
  );
}

function workspaceDescription(workspace: Workspace) {
  const descriptions: Record<Workspace, string> = {
    Overview: 'A live view of decisions, review queues, and sandbox activity.',
    'Allocate Task': 'Submit a synthetic workflow for policy and security evaluation.',
    'FinShield AI': 'Review evaluations, evidence, and human approvals.',
    'Bank Agent': 'Execute only authorized operations in the simulated banking core.',
    History: 'Search previous sandbox tasks and their audit events.',
    Settings: 'Review provider status and configure demo policy rules.',
  };
  return descriptions[workspace];
}

function Overview({
  metrics, tasks, isLoading, onOpenTask, onNavigate, onShowPendingTasks, onLoadDemo,
}: {
  metrics: DashboardMetrics;
  tasks: Task[];
  isLoading: boolean;
  onOpenTask: (task: Task) => void;
  onNavigate: (workspace: Workspace) => void;
  onShowPendingTasks: () => void;
  onLoadDemo: () => void;
}) {
  const todayCards = [
    { title: 'Evaluated today', value: metrics.totalToday, icon: FileCheck2, color: 'plum', click: () => onNavigate('History') },
    { title: 'Pending tasks', value: metrics.pendingTasks, icon: ClipboardList, color: 'amber', click: onShowPendingTasks, period: 'Awaiting evaluation' },
    { title: 'Allowed', value: metrics.allowedToday, icon: ShieldCheck, color: 'teal', click: () => onNavigate('FinShield AI') },
    { title: 'Blocked', value: metrics.blockedToday, icon: ShieldX, color: 'red', click: () => onNavigate('FinShield AI') },
    { title: 'Needs verification', value: metrics.verifyToday, icon: ShieldAlert, color: 'amber', click: () => onNavigate('FinShield AI') },
  ];
  const recentTasks = tasks.slice(0, 6);
  const decisionTotal = metrics.allowedToday + metrics.blockedToday + metrics.verifyToday;
  const allowPct = decisionTotal ? Math.round(metrics.allowedToday / decisionTotal * 100) : 0;
  const blockPct = decisionTotal ? Math.round(metrics.blockedToday / decisionTotal * 100) : 0;
  const verifyPct = decisionTotal ? 100 - allowPct - blockPct : 0;

  return (
    <>
      <div className="metrics-grid">
        {todayCards.map(({ title, value, icon: Icon, color, click, period = 'Today' }) => (
          <button className="metric-card" key={title} onClick={click}>
            <div className={`metric-icon metric-${color}`}><Icon size={18} /></div>
            <span className="metric-label">{title}</span>
            <strong className="metric-value">{isLoading ? '—' : value.toLocaleString()}</strong>
            <span className="metric-period">{period} <ArrowUpRight size={13} /></span>
          </button>
        ))}
      </div>

      <div className="secondary-metrics">
        <div><span className="mini-dot dot-blue" /><span>Processing</span><strong>{metrics.processing}</strong></div>
        <div><span className="mini-dot dot-red" /><span>High-risk alerts</span><strong>{metrics.highRiskAlerts}</strong></div>
        <div><span className="mini-dot dot-amber" /><span>Pending reviews</span><strong>{metrics.pendingReviews}</strong></div>
        <div><span className="mini-dot dot-plum" /><span>Avg. processing</span><strong>{formatDuration(metrics.avgProcessingMs)}</strong></div>
      </div>

      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-heading">
            <div><h2>Live task activity</h2><p>Latest submissions and policy decisions</p></div>
            <button className="text-button" onClick={() => onNavigate('History')}>View history <ArrowRight size={14} /></button>
          </div>
          {recentTasks.length ? <TaskTable tasks={recentTasks} onOpenTask={onOpenTask} compact /> : (
            <EmptyState
              icon={Activity}
              title={isLoading ? 'Loading task activity' : 'No task activity yet'}
              description={isLoading ? 'Refreshing the demo task store…' : 'Load synthetic examples or allocate a new task to see decisions here.'}
              action={!isLoading ? <button className="button button-secondary" onClick={onLoadDemo}>Load sample data</button> : undefined}
            />
          )}
        </section>
        <div className="insights-column">
          <section className="panel risk-panel">
            <div className="panel-heading"><div><h2>Decision distribution</h2><p>Today · based on evaluated tasks</p></div><SlidersHorizontal size={17} className="muted-icon" /></div>
            <div className="distribution-total"><strong>{decisionTotal}</strong><span>evaluations</span></div>
            <div className="distribution-bar" aria-label={`${allowPct}% allow, ${blockPct}% block, ${verifyPct}% verify`}>
              <span style={{ width: `${allowPct}%` }} className="bar-allow" />
              <span style={{ width: `${blockPct}%` }} className="bar-block" />
              <span style={{ width: `${verifyPct}%` }} className="bar-verify" />
            </div>
            <div className="distribution-legend">
              <span><i className="legend-allow" />Allow <b>{metrics.allowedToday}</b></span>
              <span><i className="legend-block" />Block <b>{metrics.blockedToday}</b></span>
              <span><i className="legend-verify" />Verify <b>{metrics.verifyToday}</b></span>
            </div>
          </section>
          <section className="panel attention-panel">
            <div className="panel-heading"><div><h2>Needs attention</h2><p>Security review queue</p></div><AlertTriangle size={17} className="attention-icon" /></div>
            <button className="attention-row" onClick={() => onNavigate('FinShield AI')}>
              <div className="attention-symbol attention-amber"><FileClock size={16} /></div>
              <div><strong>Human review queue</strong><span>Waiting for reviewer decision</span></div>
              <b>{metrics.pendingReviews}</b><ChevronRight size={15} />
            </button>
            <button className="attention-row" onClick={() => onNavigate('FinShield AI')}>
              <div className="attention-symbol attention-red"><ShieldAlert size={16} /></div>
              <div><strong>High-risk alerts</strong><span>Risk score 70 or above</span></div>
              <b>{metrics.highRiskAlerts}</b><ChevronRight size={15} />
            </button>
          </section>
        </div>
      </div>
      <section className="panel activity-strip">
        <div className="activity-leading"><div className="activity-symbol"><Sparkles size={17} /></div><div><strong>Evaluation pipeline</strong><span>Independent synthetic tasks · sequenced checks per task</span></div></div>
        <div className="pipeline-mini"><span>Document</span><ArrowRight size={13} /><span>Security</span><ArrowRight size={13} /><span>Policy</span><ArrowRight size={13} /><span>Decision</span></div>
        <button className="icon-button" title="Open FinShield AI workspace" onClick={() => onNavigate('FinShield AI')}><ArrowUpRight size={16} /></button>
      </section>
    </>
  );
}

function AllocateTask({
  taskType, setTaskType, taskTitle, setTaskTitle, instructions, setInstructions,
  referenceId, setReferenceId, selectedFiles, setSelectedFiles, isSubmitting, onSubmit, tasks, onOpenTask,
}: {
  taskType: (typeof TASK_TYPES)[number];
  setTaskType: (type: (typeof TASK_TYPES)[number]) => void;
  taskTitle: string;
  setTaskTitle: (title: string) => void;
  instructions: string;
  setInstructions: (instructions: string) => void;
  referenceId: string;
  setReferenceId: (id: string) => void;
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;
  isSubmitting: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  return (
    <div className="allocate-layout">
      <section className="panel form-panel">
        <div className="panel-heading">
          <div><h2>New task request</h2><p>Each uploaded file becomes an independently evaluated task with its own ID.</p></div>
          <div className="form-step">01 <span>/ 01</span></div>
        </div>
        <div className="sample-task-callout">
          <div><strong>Try a sample workflow</strong><span>Prefills a synthetic invoice request; no file is needed. Expected result: Verify while the high-amount policy is active.</span></div>
          <button
            className="button button-small button-secondary"
            type="button"
            onClick={() => {
              setTaskType('invoice_verification');
              setTaskTitle('Demo invoice review - INV-DEMO-2026-001');
              setReferenceId('INV-DEMO-2026-001');
              setInstructions('Invoice Number: INV-DEMO-2026-001\nVendor: Demo Supplies Co\nAmount: $12,450.00\nDescription: Synthetic office-supplies invoice\nPlease verify the invoice details and identify any policy checks that need human review.');
              setSelectedFiles([]);
            }}
          >
            Use sample
          </button>
        </div>
        <form onSubmit={onSubmit} className="task-form">
          <label className="field-label">Task type <span className="required">*</span>
            <select className="form-control" value={taskType} onChange={(event) => setTaskType(event.target.value as (typeof TASK_TYPES)[number])}>
              {TASK_TYPES.map((type) => <option key={type} value={type}>{TASK_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="field-label">Task title
            <input className="form-control" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={160} placeholder="e.g. Verify ACME invoice #INV-1042" />
          </label>
          <label className="field-label">Business reference <span className="field-optional">Optional</span>
            <input className="form-control" value={referenceId} onChange={(event) => setReferenceId(event.target.value)} maxLength={100} placeholder="Invoice, vendor, or account reference" />
          </label>
          <label className="field-label">Task instructions <span className="field-optional">Optional · untrusted input</span>
            <textarea className="form-control form-textarea" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={4000} placeholder="Add context for the synthetic workflow…" rows={4} />
          </label>
          <div className="field-label">Supporting files <span className="field-optional">Optional · up to 8 files, 10 MB each</span>
            <label className={`upload-zone ${selectedFiles.length ? 'upload-zone-selected' : ''}`}>
              <input
                type="file"
                accept=".pdf,.csv,.txt"
                multiple
                onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
              />
              {selectedFiles.length
                ? <><FileCheck2 size={22} /><strong>{selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected</strong><span>{selectedFiles.map((file) => file.name).join(', ')}</span></>
                : <><Upload size={22} /><strong>Choose supporting files</strong><span>Text-based PDF (up to 50 pages), CSV, TXT · up to 8 files</span></>}
            </label>
            <div className="inline-notice"><CircleHelp size={14} /> Files are parsed on the server and converted to CSV. Scanned PDFs, images, and XLSX files are not supported yet.</div>
          </div>
          <div className="form-footer"><span><LockKeyhole size={13} /> Synthetic sandbox · no funds moved</span><button className="button button-primary" type="submit" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{isSubmitting ? 'Submitting…' : 'Submit for evaluation'}</button></div>
        </form>
      </section>
      <aside className="allocate-aside">
        <section className="panel queue-panel">
          <div className="panel-heading"><div><h2>Recent submissions</h2><p>Saved locally in SQLite</p></div><span className="queue-count">{tasks.length}</span></div>
          {tasks.slice(0, 8).map((task) => (
            <button className="queue-row" key={task.id} onClick={() => onOpenTask(task)}>
              <span><span className="mono">{task.task_number}</span><span className="queue-title">{task.title}</span></span><span className={outcomeClass(outcomeFor(task))}>{humanize(outcomeFor(task))}</span><ChevronRight size={14} />
            </button>
          ))}
          {!tasks.length && <div className="small-empty">No saved submissions yet.</div>}
        </section>
      </aside>
    </div>
  );
}

function FinShieldWorkspace({
  tasks, detail, isLoading, searchQuery, setSearchQuery, decisionFilter, setDecisionFilter,
  typeFilter, setTypeFilter, queueFilter, setQueueFilter, reviewReason, setReviewReason,
  onCloseDetail, onOpenTask, onReview, onExecute, onLoadDemo,
}: {
  tasks: Task[];
  detail: TaskDetail | null;
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  decisionFilter: string;
  setDecisionFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  queueFilter: 'all' | 'pending';
  setQueueFilter: (value: 'all' | 'pending') => void;
  reviewReason: string;
  setReviewReason: (value: string) => void;
  onCloseDetail: () => void;
  onOpenTask: (task: Task) => void;
  onReview: (decision: 'approved' | 'rejected' | 'info_requested') => void;
  onExecute: (task: Task) => void;
  onLoadDemo: () => void;
}) {
  return (
    <>
      <div className="workspace-toolbar">
        <div className="search-field"><Search size={16} /><input aria-label="Search tasks" placeholder="Search task ID, title, or file" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div>
        <select className="filter-select" aria-label="Filter by decision" value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}>
          <option value="all">All decisions</option><option value="ALLOW">Allow</option><option value="BLOCK">Block</option><option value="VERIFY">Verify</option>
        </select>
        <select className="filter-select" aria-label="Filter by task type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">All task types</option>{TASK_TYPES.map((type) => <option key={type} value={type}>{TASK_TYPE_LABELS[type]}</option>)}
        </select>
        <select className="filter-select" aria-label="Filter by evaluation status" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as 'all' | 'pending')}>
          <option value="all">All task statuses</option><option value="pending">Awaiting evaluation</option>
        </select>
        <span className="result-count">{tasks.length} tasks</span>
      </div>
      <section className="panel task-panel">
        {tasks.length ? <TaskTable tasks={tasks} onOpenTask={onOpenTask} /> : (
          <EmptyState icon={FileSearch} title={isLoading ? 'Loading tasks' : 'No matching tasks'} description={isLoading ? 'Checking the current sandbox session.' : 'Try changing the filters or load synthetic examples.'} action={!isLoading ? <button className="button button-secondary" onClick={onLoadDemo}>Load sample data</button> : undefined} />
        )}
      </section>
      {detail && (
        <TaskDetailPanel
          detail={detail}
          onClose={onCloseDetail}
          reviewReason={reviewReason}
          setReviewReason={setReviewReason}
          onReview={onReview}
          onExecute={onExecute}
        />
      )}
    </>
  );
}

function TaskTable({ tasks, onOpenTask, compact = false }: { tasks: Task[]; onOpenTask: (task: Task) => void; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={`data-table ${compact ? 'data-table-compact' : ''}`}>
        <thead><tr><th>Task / request</th><th>Type</th><th>Submitted</th><th>Stage</th><th>Decision</th><th>Risk</th><th><span className="sr-only">Open</span></th></tr></thead>
        <tbody>
          {tasks.map((task) => {
            const decision = outcomeFor(task);
            const DecisionIcon = getIconForDecision(decision);
            return (
              <tr key={task.id}>
                <td><button className="task-link" onClick={() => onOpenTask(task)}><span className="mono">{task.task_number}</span><span className="table-title">{task.title}</span></button></td>
                <td><span className="table-type">{TASK_TYPE_LABELS[task.type]}</span></td>
                <td className="nowrap">{formatDate(task.created_at)}</td>
                <td><span className={`stage-label ${task.state === 'awaiting_review' ? 'stage-review' : ''}`}><span className="stage-dot" />{humanize(task.state)}</span></td>
                <td><span className={outcomeClass(decision)}><DecisionIcon size={13} />{humanize(decision)}</span></td>
                <td>{task.risk_score === null ? <span className="muted">—</span> : <span className={`risk-score ${task.risk_score >= 70 ? 'risk-high' : task.risk_score >= 40 ? 'risk-medium' : 'risk-low'}`}>{task.risk_score}<span>/100</span></span>}</td>
                <td><button className="icon-button table-open" aria-label={`Open ${task.task_number}`} onClick={() => onOpenTask(task)}><ChevronRight size={16} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskDetailPanel({
  detail, onClose, reviewReason, setReviewReason, onReview, onExecute,
}: {
  detail: TaskDetail;
  onClose: () => void;
  reviewReason?: string;
  setReviewReason?: (value: string) => void;
  onReview?: (decision: 'approved' | 'rejected' | 'info_requested') => void;
  onExecute?: (task: Task) => void;
}) {
  const { task, events, extractedFields, securityFindings, evaluationResult, humanReviews, sandboxExecution, convertedCsv } = detail;
  const canReview = task.state === 'awaiting_review' && onReview && setReviewReason;
  const canExecute = task.state === 'allowed' && onExecute;
  const agentOneComplete = events.some((event) => event.event_type === 'extraction_completed');
  const agentTwoComplete = events.some((event) =>
    event.event_type === 'security_analysis_completed' || event.event_type === 'security_findings_recorded'
  );
  const agentThreeComplete = events.some((event) => event.event_type === 'decision_generated');
  const agentOneStarted = events.some((event) => event.event_type === 'extraction_started');
  const agentTwoStarted = events.some((event) => event.event_type === 'security_analysis_started');
  const agentThreeStarted = events.some((event) => event.event_type === 'policy_check_started');
  const agentStatus = (complete: boolean, started: boolean) => complete ? 'Completed' : started ? task.state === 'failed' ? 'Failed' : 'Working' : 'Waiting';
  const agentTwoResult = [...events].reverse().find((event) => event.event_type === 'security_findings_recorded');
  const agentTwoAIResult = [...events].reverse().find((event) =>
    event.event_type === 'security_findings_recorded' && typeof event.details?.aiProvider === 'string'
  );
  const agentThreeResult = [...events].reverse().find((event) => event.event_type === 'policy_check_completed');
  const agentTwoRisk = agentTwoResult?.details?.riskScore;
  const agentTwoChecks = agentTwoResult?.details?.checksPerformed;
  const extractedFieldCount = extractedFields
    ? [
        extractedFields.invoice_number,
        extractedFields.vendor_name,
        extractedFields.vendor_id,
        extractedFields.invoice_date,
        extractedFields.due_date,
        extractedFields.amount,
        extractedFields.currency,
        extractedFields.account_number,
        extractedFields.bank_details,
        extractedFields.description,
        extractedFields.requested_action,
      ].filter((value) => value !== null && value !== '').length
    : 0;

  function downloadConvertedCsv() {
    if (!convertedCsv) return;
    const url = URL.createObjectURL(new Blob([convertedCsv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${task.task_number.toLowerCase()}-converted.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel detail-panel" id="task-detail">
      <div className="detail-header">
        <div><div className="eyebrow">TASK EVALUATION</div><h2 className="mono">{task.task_number}</h2><p>{task.title}</p></div>
        <div className="detail-header-actions"><span className={outcomeClass(outcomeFor(task))}>{humanize(outcomeFor(task))}</span><button className="icon-button" aria-label="Close task details" onClick={onClose}><X size={17} /></button></div>
      </div>
      <div className="detail-summary">
        <div><span>Task type</span><strong>{TASK_TYPE_LABELS[task.type]}</strong></div>
        <div><span>Submitted</span><strong>{formatDate(task.created_at)}</strong></div>
        <div><span>Risk score</span><strong>{task.risk_score === null ? 'Not evaluated' : `${task.risk_score} / 100`}</strong></div>
        <div><span>Model confidence</span><strong>{task.model_confidence === null ? 'Not reported' : `${Math.round(task.model_confidence * 100)}% · uncalibrated`}</strong></div>
      </div>
      <div className="submission-info">
        <h3>Original task submission</h3>
        <div><span>Supporting file</span><strong>{task.file_name || 'No file attached'}</strong><span>{task.file_size ? `${(task.file_size / 1024).toFixed(1)} KB · ${task.file_type || 'file'}` : ''}</span></div>
        <div><span>Business reference</span><strong>{task.reference_id || 'Not provided'}</strong></div>
        <div className="submission-instructions"><span>Task instructions</span><p>{task.instructions || 'No additional instructions were provided.'}</p></div>
      </div>
      {task.state === 'failed' && task.error_message && <div className="task-failure-notice" role="alert"><AlertTriangle size={16} /><div><strong>Processing stopped</strong><p>{task.error_message}</p></div></div>}
      <section className="agent-workflow">
        <div className="section-title"><Activity size={16} /><h3>Three-agent workflow</h3></div>
        <div className="agent-workflow-grid">
          <article className="agent-step">
            <div><span>AGENT 1 · DOCUMENT</span><strong className={agentStatus(agentOneComplete, agentOneStarted) === 'Completed' ? 'agent-done' : ''}>{agentStatus(agentOneComplete, agentOneStarted)}</strong></div>
            <p>{task.file_name ? 'Validated the uploaded file, extracted document text, and converted it to CSV.' : 'Parsed the submitted task title and instructions and extracted available fields.'} This content is passed to Agent 2.</p>
            <small>{extractedFields ? `${extractedFieldCount} fields extracted · ${extractedFields.extraction_method || 'text parser'}` : task.file_name ? 'Reading the uploaded document…' : 'No supporting file; using task details only.'}</small>
          </article>
          <article className="agent-step">
            <div><span>AGENT 2 · SECURITY</span><strong className={agentStatus(agentTwoComplete, agentTwoStarted) === 'Completed' ? 'agent-done' : ''}>{agentStatus(agentTwoComplete, agentTwoStarted)}</strong></div>
            <p>Scanned document text and instructions for prompt injection, suspicious content, amount anomalies, and missing information. Findings and risk are sent to Agent 3.</p>
            <small>{agentTwoComplete ? `${securityFindings.length} finding(s) · risk ${typeof agentTwoRisk === 'number' ? `${agentTwoRisk}/100` : 'recorded'} · ${Array.isArray(agentTwoChecks) ? agentTwoChecks.length : 'security'} checks${agentTwoAIResult ? ` · ${String(agentTwoAIResult.details?.aiProvider)} / ${String(agentTwoAIResult.details?.aiModel)}` : ''}` : 'Waiting for document processing.'}</small>
            {agentTwoComplete && Array.isArray(agentTwoChecks) && agentTwoChecks.length > 0 && <div className="agent-checks"><span>Checks performed</span><p>{agentTwoChecks.filter((check): check is string => typeof check === 'string').map(humanize).join(' · ')}</p></div>}
          </article>
          <article className="agent-step">
            <div><span>AGENT 3 · POLICY & DECISION</span><strong className={agentStatus(agentThreeComplete, agentThreeStarted) === 'Completed' ? 'agent-done' : ''}>{agentStatus(agentThreeComplete, agentThreeStarted)}</strong></div>
            <p>Sent Agent 1’s extracted data, Agent 2’s findings, and active policy evidence to a live model, which makes the final Allow, Verify, or Block decision.</p>
            <small>{evaluationResult ? `${evaluationResult.decision} · ${evaluationResult.model_provider} / ${evaluationResult.model_id} · confidence ${evaluationResult.model_confidence === null ? 'not reported' : `${Math.round(evaluationResult.model_confidence * 100)}% (model-reported, uncalibrated)`}` : agentThreeResult ? `${String(agentThreeResult.details?.provider)} / ${String(agentThreeResult.details?.modelId)} · decision call completed` : 'Waiting for security analysis.'}</small>
          </article>
        </div>
      </section>
      {evaluationResult && <div className="evaluation-explanation"><ShieldCheck size={16} /><div><strong>Live AI decision rationale · {evaluationResult.model_provider} / {evaluationResult.model_id}</strong><p>{evaluationResult.explanation}</p><span>{evaluationResult.policy_checks_passed}/{evaluationResult.policy_checks_total} local policy checks passed · provided to the model as evidence · confidence is self-reported and uncalibrated</span></div></div>}
      {convertedCsv && <div className="converted-csv"><div><strong>Converted CSV is ready</strong><span>Generated from the uploaded document for review and download.</span></div><button className="button button-secondary button-small" onClick={downloadConvertedCsv}><FileDown size={14} /> Download CSV</button></div>}

      <div className="detail-grid">
        <div className="detail-column">
          <div className="detail-section"><div className="section-title"><FileSearch size={16} /><h3>Extracted fields</h3></div>
            {extractedFields ? <div className="extracted-grid">
              {[
                ['Vendor', extractedFields.vendor_name],
                ['Vendor ID', extractedFields.vendor_id],
                ['Invoice', extractedFields.invoice_number],
                ['Amount', extractedFields.amount === null ? null : `${extractedFields.currency || 'USD'} ${extractedFields.amount.toLocaleString()}`],
                ['Invoice date', extractedFields.invoice_date],
                ['Due date', extractedFields.due_date],
                ['Account number', extractedFields.account_number],
                ['Bank details', extractedFields.bank_details],
                ['Description', extractedFields.description],
                ['Requested action', extractedFields.requested_action],
                ['Extraction method', extractedFields.extraction_method],
              ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || 'Not available'}</strong></div>)}
              {extractedFields.missing_fields.length > 0 && <div className="extraction-notice"><span>Missing required fields</span><strong>{extractedFields.missing_fields.join(', ')}</strong></div>}
              {extractedFields.warnings.length > 0 && <div className="extraction-notice"><span>Agent 1 notes</span><strong>{extractedFields.warnings.join(' ')}</strong></div>}
            </div> : <p className="muted-text">Extraction fields are not available yet.</p>}
            {extractedFields?.raw_text && <details className="agent-raw-text"><summary>View Agent 1 processed text</summary><pre>{extractedFields.raw_text}</pre></details>}
          </div>
          <div className="detail-section"><div className="section-title"><ShieldAlert size={16} /><h3>Security findings <span className="section-count">{securityFindings.length}</span></h3></div>
            {securityFindings.length ? securityFindings.map((finding) => <div className="finding-card" key={finding.id}><div className="finding-heading"><strong>{finding.title}</strong><span className={`severity severity-${finding.severity}`}>{finding.severity}</span></div><p>{finding.description}</p>{finding.evidence && <blockquote>{finding.evidence}</blockquote>}</div>) : <p className="muted-text">No findings recorded for this task.</p>}
          </div>
          {canReview && <div className="review-action-panel">
            <div className="section-title"><UserRound size={16} /><h3>Reviewer decision</h3></div>
            <p>Provide a reason. Approval pauses or permits only the sandbox operation; it never overrides a security block.</p>
            <textarea className="form-control form-textarea" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength={5} maxLength={2000} placeholder="Record the evidence and reason for your decision…" rows={3} />
            <div className="review-buttons">
              <button className="button button-primary"               disabled={!reviewReason || reviewReason.trim().length < 5} onClick={() => onReview?.('approved')}><Check size={15} /> Approve</button>
              <button className="button button-danger"               disabled={!reviewReason || reviewReason.trim().length < 5} onClick={() => onReview?.('rejected')}><ShieldX size={15} /> Reject</button>
              <button className="button button-secondary"               disabled={!reviewReason || reviewReason.trim().length < 5} onClick={() => onReview?.('info_requested')}><CircleHelp size={15} /> Request info</button>
            </div>
          </div>}
          {canExecute && <div className="execute-callout"><div><strong>Eligible for sandbox execution</strong><span>This simulates a banking operation. It does not transfer money.</span></div><button className="button button-primary" onClick={() => onExecute?.(task)}><Banknote size={16} /> Run sandbox</button></div>}
          {sandboxExecution && <div className="execution-result"><CheckCircle2 size={16} /><div><strong>Sandbox execution · {humanize(sandboxExecution.status)}</strong><span>{sandboxExecution.mock_reference_id || 'No mock reference'} · {formatDate(sandboxExecution.completed_at)}</span></div></div>}
          {humanReviews.length > 0 && <div className="review-history"><strong>Review record</strong>{humanReviews.map((review) => <p key={review.id}>{humanize(review.decision)} · {review.reason} · {formatDate(review.created_at)}</p>)}</div>}
        </div>
        <div className="detail-column timeline-column">
          <div className="detail-section"><div className="section-title"><Clock3 size={16} /><h3>Evaluation timeline</h3></div>
            {events.length ? <ol className="timeline-list">{events.map((event) => <li key={event.id}><span className="timeline-marker" /><div><strong>{humanize(event.event_type)}</strong><span>{event.actor} · {event.service}</span><time>{formatDate(event.created_at)}</time></div></li>)}</ol> : <p className="muted-text">No timeline events yet.</p>}
          </div>
          {evaluationResult && <div className="detail-section">
            <div className="section-title"><ListFilter size={16} /><h3>Policy checks <span className="section-count">{evaluationResult.policy_checks?.length ?? evaluationResult.policy_checks_total}</span></h3></div>
            {evaluationResult.policy_checks?.length
              ? <div className="policy-check-list">{evaluationResult.policy_checks.map((check) => (
                <article className={`policy-check ${check.passed ? 'policy-check-passed' : 'policy-check-failed'}`} key={check.policyId}>
                  <div><strong>{check.policyName}</strong><span>{check.passed ? 'PASSED' : `${check.action.toUpperCase()} RULE`}</span></div>
                  <p>{check.details}</p>
                </article>
              ))}</div>
              : <p className="muted-text">{evaluationResult.evidence_summary}</p>}
          </div>}
        </div>
      </div>
    </section>
  );
}

function BankAgentWorkspace({ tasks, onOpenTask, onExecute, onLoadDemo }: { tasks: Task[]; onOpenTask: (task: Task) => void; onExecute: (task: Task) => void; onLoadDemo: () => void }) {
  const bankTasks = tasks.filter((task) => ['allowed', 'executing', 'completed'].includes(task.state) || Boolean(task.execution_status));
  const readyCount = bankTasks.filter((task) => task.state === 'allowed' && !task.execution_status).length;
  const executingCount = bankTasks.filter((task) => task.state === 'executing' || task.execution_status === 'executing').length;
  const executedCount = bankTasks.filter((task) => task.execution_status === 'completed' || task.state === 'completed').length;
  return (
    <>
      <div className="sandbox-banner"><div className="sandbox-banner-icon"><Banknote size={18} /></div><div><strong>Banking sandbox</strong><span>Mock operations only · no live accounts, payment rails, or real funds</span></div><span className="sandbox-status"><i /> SIMULATION ONLY</span></div>
      <div className="bank-agent-summary">
        <div><span>Ready for execution</span><strong>{readyCount}</strong></div>
        <div><span>Executing</span><strong>{executingCount}</strong></div>
        <div><span>Executed</span><strong>{executedCount}</strong></div>
      </div>
      <section className="panel task-panel">
        <div className="panel-heading"><div><h2>Bank Agent task execution</h2><p>Authorized tasks awaiting execution, currently running, and completed sandbox operations</p></div><span className="queue-count">{bankTasks.length}</span></div>
        {bankTasks.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Task</th><th>Operation</th><th>Decision</th><th>Execution status</th><th>Reference</th><th>Action</th></tr></thead><tbody>
          {bankTasks.map((task) => {
            const status = task.execution_status === 'completed' || task.state === 'completed'
              ? 'Executed'
              : task.execution_status === 'executing' || task.state === 'executing'
                ? 'Executing'
                : task.execution_status === 'failed' ? 'Failed'
                  : 'Ready';
            return <tr key={task.id}><td><button className="task-link" onClick={() => onOpenTask(task)}><span className="mono">{task.task_number}</span><span className="table-title">{task.title}</span></button></td><td>{TASK_TYPE_LABELS[task.type]}</td><td><span className={outcomeClass(outcomeFor(task))}>{humanize(outcomeFor(task))}</span></td><td><span className={`stage-label ${status === 'Executing' ? 'stage-review' : ''}`}><span className="stage-dot" />{status}</span></td><td className="mono">{task.execution_reference || task.reference_id || '—'}</td><td>{status === 'Ready' || status === 'Failed' ? task.state === 'allowed' ? <button className="button button-small button-primary" onClick={() => onExecute(task)}><Banknote size={14} /> {status === 'Failed' ? 'Retry' : 'Execute'}</button> : <span className="muted">—</span> : status === 'Executed' ? <span className="completed-label"><CheckCircle2 size={14} /> Executed</span> : <span className="muted">In progress</span>}</td></tr>;
          })}
        </tbody></table></div> : <EmptyState icon={Banknote} title="No authorized operations" description="Tasks must pass policy checks or receive valid human approval before they appear here." action={!tasks.length ? <button className="button button-secondary" onClick={onLoadDemo}>Load sample data</button> : undefined} />}
      </section>
    </>
  );
}

function HistoryWorkspace({
  tasks, isLoading, searchQuery, setSearchQuery, decisionFilter, setDecisionFilter, typeFilter, setTypeFilter, onOpenTask, onLoadDemo,
}: {
  tasks: Task[];
  isLoading: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  decisionFilter: string;
  setDecisionFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  onOpenTask: (task: Task) => void;
  onLoadDemo: () => void;
}) {
  return (
    <>
      <div className="history-summary"><div><span>Total in session</span><strong>{tasks.length}</strong></div><div><span>Allowed / completed</span><strong>{tasks.filter((task) => task.state === 'allowed' || task.state === 'completed').length}</strong></div><div><span>Blocked</span><strong>{tasks.filter((task) => task.state === 'blocked').length}</strong></div><div><span>Awaiting review</span><strong>{tasks.filter((task) => task.state === 'awaiting_review').length}</strong></div></div>
      <div className="workspace-toolbar">
        <div className="search-field"><Search size={16} /><input aria-label="Search task history" placeholder="Search task ID, title, or file" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div>
        <select className="filter-select" aria-label="Filter history by decision" value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)}><option value="all">All decisions</option><option value="ALLOW">Allow</option><option value="BLOCK">Block</option><option value="VERIFY">Verify</option></select>
        <select className="filter-select" aria-label="Filter history by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All task types</option>{TASK_TYPES.map((type) => <option key={type} value={type}>{TASK_TYPE_LABELS[type]}</option>)}</select>
        <span className="result-count">{tasks.length} records</span>
      </div>
      <section className="panel task-panel">{tasks.length ? <TaskTable tasks={tasks} onOpenTask={onOpenTask} /> : <EmptyState icon={History} title={isLoading ? 'Loading history' : 'No history found'} description={isLoading ? 'Loading the session audit record.' : 'Adjust your search, or load synthetic records for this session.'} action={!isLoading ? <button className="button button-secondary" onClick={onLoadDemo}>Load sample data</button> : undefined} />}</section>
    </>
  );
}

function SettingsWorkspace({
  policies, providerStatus, isTestingProvider, onTogglePolicy, onTestProvider,
}: {
  policies: PolicyRule[];
  providerStatus: ProviderStatus | null;
  isTestingProvider: boolean;
  onTogglePolicy: (policy: PolicyRule) => void;
  onTestProvider: (provider: 'gemini' | 'nemotron') => void;
}) {
  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>AI providers</h2><p>Exactly two provider keys, loaded privately by the server.</p></div><div className="provider-badge"><span className={providerStatus?.activeProvider === 'unavailable' ? 'provider-dot provider-demo' : 'provider-dot'} />{providerStatus?.activeProvider === 'unavailable' ? 'CONFIGURATION REQUIRED' : 'LIVE AI REQUIRED'}</div></div>
        <div className="provider-active"><div className="provider-active-icon"><AudioLines size={18} /></div><div><span>Selected provider (connection must be tested)</span><strong>{providerStatus ? (providerStatus.activeProvider === 'unavailable' ? 'No live provider configured' : providerStatus.activeProvider === 'gemini' ? 'Google Gemini' : 'Nemotron via OpenRouter') : 'Loading provider status…'}</strong></div></div>
        <div className="provider-list">
          <ProviderRow name="Google Gemini" identifier="GEMINI_API_KEY" model="gemini-3.1-pro-preview" configured={providerStatus?.hasGemini || false} loading={isTestingProvider} onTest={() => onTestProvider('gemini')} />
          <ProviderRow name="Nemotron 3 Ultra via OpenRouter" identifier="NEMOTRON_API_KEY" model="nvidia/nemotron-3-ultra-550b-a55b" configured={providerStatus?.hasNemotron || false} loading={isTestingProvider} onTest={() => onTestProvider('nemotron')} />
        </div>
        <div className="inline-notice"><LockKeyhole size={14} /> Configure the OpenRouter key in <code>NEMOTRON_API_KEY</code> in <code>.env.local</code>, then restart the server. Key presence does not confirm valid credentials or quota; use Test connection. Never use a <code>NEXT_PUBLIC_</code> prefix for secrets.</div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Policy configuration</h2><p>Toggle demo rules. Each update applies to subsequent evaluations.</p></div><span className="queue-count">{policies.length}</span></div>
        {policies.length ? <div className="policy-list">{policies.map((policy) => <div className="policy-row" key={policy.id}><div className="policy-status"><ShieldCheck size={16} /></div><div className="policy-copy"><strong>{policy.name}</strong><span>{policy.description}</span><small>{humanize(policy.category)} · {policy.action.toUpperCase()} · v{policy.version}</small></div><button className={`toggle ${policy.is_active ? 'toggle-on' : ''}`} role="switch" aria-checked={policy.is_active} aria-label={`${policy.is_active ? 'Deactivate' : 'Activate'} ${policy.name}`} onClick={() => onTogglePolicy(policy)}><span /></button></div>)}</div> : <EmptyState icon={Settings2} title="No policy rules loaded" description="Load the sample data from Overview to see configurable synthetic rules." />}
      </section>
      <section className="panel settings-panel environment-settings"><div className="panel-heading"><div><h2>Runtime details</h2><p>Local demo storage and confidence reporting</p></div><LockKeyhole size={18} className="muted-icon" /></div><div className="environment-row"><span>Data store</span><strong>Local SQLite · persists across restarts</strong></div><div className="environment-row"><span>Database file</span><strong>data/finshield.sqlite · ignored by Git</strong></div><div className="environment-row"><span>Model output confidence</span><strong>Self-reported by provider when supplied; uncalibrated</strong></div></section>
    </div>
  );
}

function ProviderRow({ name, identifier, model, configured, loading, onTest }: { name: string; identifier: string; model: string; configured: boolean; loading: boolean; onTest: () => void }) {
  return <div className="provider-row"><div className="provider-logo"><Sparkles size={16} /></div><div className="provider-copy"><strong>{name}</strong><span>{identifier} · {configured ? 'Key configured' : 'Not configured'}</span><small>Model: {model}</small></div><span className={`provider-state ${configured ? 'configured' : ''}`}><i />{configured ? 'Configured' : 'Missing'}</span><button className="button button-small button-secondary" disabled={!configured || loading} onClick={onTest}>{loading ? <LoaderCircle size={14} className="spin" /> : <Activity size={14} />}Test connection</button></div>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><strong>{title}</strong><p>{description}</p>{action}</div>;
}
