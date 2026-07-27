'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Download, FileText, Loader2, RotateCcw,
  Upload, AlertTriangle, CheckCircle2, XCircle,
  Users, CreditCard, Landmark,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';

/**
 * Unified bulk-import wizard. Drives all kinds (members / contributions /
 * loans) through the same state machine:
 *   idle      → pick kind + drag-drop a CSV
 *   preview   → server-parsed; user reviews row-by-row before confirming
 *   result    → committed; per-kind summary + rollback CTA
 *
 * The /members/import page is kept as a deep-link for backward compat;
 * it delegates to the same shape as kind='members' here.
 */

type Kind = 'members' | 'contributions' | 'loans';

interface ImportRowError { row: number; message: string; raw?: Record<string, string> }

// Per-kind prepared-row shapes. The page renders a kind-specific table for
// the preview/result, but the job envelope is uniform.
interface MemberRow {
  row_num: number; phone: string; first_name: string; middle_name: string | null;
  last_name: string; email: string | null; occupation: string | null; role: string;
  warnings: string[];
}
interface ContributionRow {
  row_num: number; member_phone: string; amount: number;
  contribution_date: string; payment_method: string | null;
  mpesa_receipt: string | null; warnings: string[];
}
interface LoanRow {
  row_num: number; principal_amount: number; interest_rate: number;
  term_months: number; disbursement_date: string; status: string;
  purpose: string | null; warnings: string[];
}

interface ImportJob {
  id:                 string;
  kind:               Kind;
  status:             'previewed' | 'committed' | 'cancelled' | 'rolled_back' | 'failed';
  filename:           string | null;
  total_rows:         number;
  valid_rows:         number;
  error_rows:         number;
  errors:             ImportRowError[];
  preview_rows?:      MemberRow[] | ContributionRow[] | LoanRow[];
  created_member_ids: string[];        // used for all kinds (see memory)
  imported?:          number;
  skipped?:           number;
  deleted?:           number;          // members + loans rollback
  cancelled?:         number;          // contributions rollback
  blocked?:           { id: string; reason: string }[] | { memberId: string; reason: string }[];
}

type Phase = 'idle' | 'uploading' | 'preview' | 'committing' | 'result';

const KIND_META: Record<Kind, { label: string; icon: LucideIcon; description: string; rollback: string }> = {
  members: {
    label:       'Members',
    icon:        Users,
    description: 'Import member roster. Each row creates a new member or links an existing one to this group.',
    rollback:    'Hard delete created members (kept if they have downstream records).',
  },
  contributions: {
    label:       'Contributions',
    icon:        CreditCard,
    description: 'Import historical contribution rows. Members must already exist in this group.',
    rollback:    'Soft-cancel: rows marked status=\'cancelled\' to preserve audit trail.',
  },
  loans: {
    label:       'Loans',
    icon:        Landmark,
    description: 'Import historical loans with status active/completed/defaulted/written_off. Repayment schedule is NOT generated.',
    rollback:    'Hard delete; blocked if a loan has any completed repayments.',
  },
};

const PREVIEW_VISIBLE_ROWS = 25;

export default function DataImportPage() {
  const [kind,  setKind]  = useState<Kind>('members');
  const [phase, setPhase] = useState<Phase>('idle');
  const [job,   setJob]   = useState<ImportJob | null>(null);
  const { toast } = useToast();

  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ variant: 'destructive', title: 'CSV only', description: 'Excel (.xlsx) support is queued. Save as CSV and try again.' });
      return;
    }
    setPhase('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<ImportJob>(`/import/preview?type=${kind}`, formData);
      setJob(result);
      setPhase('preview');
    } catch (err) {
      setPhase('idle');
      const msg = err instanceof ApiError ? err.message : 'Upload failed';
      toast({ variant: 'destructive', title: 'Upload failed', description: msg });
    }
  }, [kind, toast]);

  const commit = async () => {
    if (!job) return;
    setPhase('committing');
    try {
      const result = await api.post<ImportJob>(`/import/${job.id}/commit`, {});
      setJob(result);
      setPhase('result');
      toast({ title: 'Import committed', description: `${result.imported ?? 0} row(s) added` });
    } catch (err) {
      setPhase('preview');
      const msg = err instanceof ApiError ? err.message : 'Commit failed';
      toast({ variant: 'destructive', title: 'Commit failed', description: msg });
    }
  };

  const discard = async () => {
    if (!job) return;
    try { await api.delete<void>(`/import/${job.id}`); toast({ title: 'Preview discarded' }); } catch {}
    setJob(null);
    setPhase('idle');
  };

  const rollback = async () => {
    if (!job) return;
    if (!confirm(`Roll back this ${kind} import?\n\n${KIND_META[kind].rollback}`)) return;
    try {
      const result = await api.post<ImportJob>(`/import/${job.id}/rollback`, { reason: 'User requested undo' });
      setJob(result);
      const undoneCount = result.deleted ?? result.cancelled ?? 0;
      toast({ title: 'Import rolled back', description: `${undoneCount} row(s) undone` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Rollback failed', description: err instanceof ApiError ? err.message : '' });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <PageHeader className="flex-1" title="Data Import" />
      </div>

      {/* Kind selector — locked once a job is in flight */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(KIND_META) as Kind[]).map((k) => {
          const meta   = KIND_META[k];
          const Icon   = meta.icon;
          const active = k === kind;
          const locked = phase !== 'idle';
          return (
            <button
              key={k}
              type="button"
              disabled={locked}
              onClick={() => setKind(k)}
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors
                ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-muted'}
                ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <Icon size={14} /> {meta.label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">{KIND_META[kind].description}</p>

      {phase === 'idle' && <IdleView kind={kind} onUpload={uploadFile} />}

      {phase === 'uploading' && (
        <Card><CardContent className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Parsing and validating your file…</span>
        </CardContent></Card>
      )}

      {phase === 'preview' && job && (
        <PreviewView job={job} onCommit={commit} onDiscard={discard} />
      )}

      {phase === 'committing' && (
        <Card><CardContent className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-muted-foreground">Writing rows…</span>
        </CardContent></Card>
      )}

      {phase === 'result' && job && (
        <ResultView job={job} onRollback={rollback} onStartOver={() => { setJob(null); setPhase('idle'); }} />
      )}
    </div>
  );
}

// ── Idle (drag-drop + template) ─────────────────────────────────────────

function IdleView({ kind, onUpload }: { kind: Kind; onUpload: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  const inputEl         = useRef<HTMLInputElement>(null);
  const handleFile = (f: File | undefined) => { if (f) onUpload(f); };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader><CardTitle>Upload CSV</CardTitle></CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => inputEl.current?.click()}
            role="button"
            tabIndex={0}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors
              ${drag ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/60'}`}
          >
            <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 font-medium">Drag &amp; drop your {KIND_META[kind].label.toLowerCase()} CSV</p>
            <p className="text-sm text-muted-foreground">or click to browse</p>
            <p className="mt-3 text-xs text-muted-foreground">Maximum 5MB · up to 5000 rows · CSV only</p>
            <input
              ref={inputEl}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="Upload CSV file"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Template</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Use the canonical column names. Headers are case-insensitive and accept common aliases.
          </p>
          <Button asChild variant="outline" className="w-full">
            <a href={`/api/v1/import/template?type=${kind}`} download>
              <Download className="mr-2 h-4 w-4" /> Download {KIND_META[kind].label.toLowerCase()} template
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Preview ─────────────────────────────────────────────────────────────

function PreviewView({ job, onCommit, onDiscard }: { job: ImportJob; onCommit: () => void; onDiscard: () => void }) {
  const rows = (job.preview_rows ?? []) as MemberRow[] | ContributionRow[] | LoanRow[];
  const visible = rows.slice(0, PREVIEW_VISIBLE_ROWS);
  const hiddenCount = Math.max(rows.length - PREVIEW_VISIBLE_ROWS, 0);
  const hasErrors   = job.error_rows > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Total rows" value={job.total_rows} />
        <SummaryCard label="Valid"      value={job.valid_rows} valueClass="text-green-600" />
        <SummaryCard label="Errors"     value={job.error_rows} valueClass={hasErrors ? 'text-red-600' : ''} />
      </div>

      {job.filename && (
        <p className="text-sm text-muted-foreground">File: <span className="font-mono">{job.filename}</span></p>
      )}

      {job.errors.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" /> Issues ({job.errors.length})
          </CardTitle></CardHeader>
          <CardContent>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {job.errors.slice(0, 100).map((e, i) => (
                <li key={i} className="font-mono">
                  {e.row > 0 ? <span className="text-muted-foreground">row {e.row}:</span> : <span className="text-amber-600">file:</span>} {e.message}
                </li>
              ))}
              {job.errors.length > 100 && (
                <li className="italic text-muted-foreground">…and {job.errors.length - 100} more</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {visible.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Preview ({visible.length} of {rows.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <PreviewTable kind={job.kind} rows={visible} />
            {hiddenCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">…and {hiddenCount} more row(s). All will be imported on confirm.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onDiscard}>Discard</Button>
        <Button onClick={onCommit} disabled={job.valid_rows === 0}>
          Confirm import ({job.valid_rows} row{job.valid_rows === 1 ? '' : 's'})
        </Button>
      </div>
    </div>
  );
}

function PreviewTable({ kind, rows }: { kind: Kind; rows: MemberRow[] | ContributionRow[] | LoanRow[] }) {
  if (kind === 'members') {
    const memberRows = rows as MemberRow[];
    return (
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">Row</th>
            <th className="py-2 pr-3">Phone</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Role</th>
            <th className="py-2 pr-3">Occupation</th>
            <th className="py-2 pr-3">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {memberRows.map((r) => (
            <tr key={r.row_num} className="border-b last:border-b-0">
              <td className="py-1.5 pr-3 font-mono text-xs">{r.row_num}</td>
              <td className="py-1.5 pr-3 font-mono">{r.phone}</td>
              <td className="py-1.5 pr-3">{[r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ')}</td>
              <td className="py-1.5 pr-3"><Badge variant="secondary">{r.role}</Badge></td>
              <td className="py-1.5 pr-3">{r.occupation ?? '—'}</td>
              <td className="py-1.5 pr-3">
                {r.warnings.length > 0 ? <span className="text-amber-600">{r.warnings.join('; ')}</span> : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (kind === 'contributions') {
    const cRows = rows as ContributionRow[];
    return (
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">Row</th>
            <th className="py-2 pr-3">Phone</th>
            <th className="py-2 pr-3 text-right">Amount</th>
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Method</th>
            <th className="py-2 pr-3">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {cRows.map((r) => (
            <tr key={r.row_num} className="border-b last:border-b-0">
              <td className="py-1.5 pr-3 font-mono text-xs">{r.row_num}</td>
              <td className="py-1.5 pr-3 font-mono">{r.member_phone}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(r.amount)}</td>
              <td className="py-1.5 pr-3">{r.contribution_date}</td>
              <td className="py-1.5 pr-3">{r.payment_method ?? '—'}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{r.mpesa_receipt ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  // loans
  const lRows = rows as LoanRow[];
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2 pr-3">Row</th>
          <th className="py-2 pr-3 text-right">Principal</th>
          <th className="py-2 pr-3 text-right">Rate</th>
          <th className="py-2 pr-3 text-right">Term</th>
          <th className="py-2 pr-3">Disbursed</th>
          <th className="py-2 pr-3">Status</th>
          <th className="py-2 pr-3">Purpose</th>
        </tr>
      </thead>
      <tbody>
        {lRows.map((r) => (
          <tr key={r.row_num} className="border-b last:border-b-0">
            <td className="py-1.5 pr-3 font-mono text-xs">{r.row_num}</td>
            <td className="py-1.5 pr-3 text-right font-mono">{new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(r.principal_amount)}</td>
            <td className="py-1.5 pr-3 text-right font-mono">{r.interest_rate}%</td>
            <td className="py-1.5 pr-3 text-right font-mono">{r.term_months} mo</td>
            <td className="py-1.5 pr-3">{r.disbursement_date}</td>
            <td className="py-1.5 pr-3"><Badge variant="outline" className="capitalize">{r.status.replace('_', ' ')}</Badge></td>
            <td className="py-1.5 pr-3">{r.purpose ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Result ──────────────────────────────────────────────────────────────

function ResultView({ job, onRollback, onStartOver }: { job: ImportJob; onRollback: () => void; onStartOver: () => void }) {
  const isCommitted  = job.status === 'committed';
  const isRolledBack = job.status === 'rolled_back';
  const undoneCount  = job.deleted ?? job.cancelled ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isRolledBack
            ? <><XCircle className="h-5 w-5 text-muted-foreground" /> Import rolled back</>
            : isCommitted
              ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> Import complete</>
              : <><AlertTriangle className="h-5 w-5 text-amber-600" /> Import {job.status}</>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard label="Imported" value={job.imported ?? job.created_member_ids.length} valueClass="text-green-600" />
          <SummaryCard label="Skipped"  value={job.skipped  ?? 0} />
          <SummaryCard label="Errors"   value={job.error_rows} valueClass={job.error_rows > 0 ? 'text-amber-600' : ''} />
        </div>

        {isRolledBack && (
          <p className="text-sm">
            {job.kind === 'contributions' ? 'Cancelled' : 'Removed'} <strong>{undoneCount}</strong> row(s).
            {(job.blocked?.length ?? 0) > 0 && (
              <> <strong>{job.blocked!.length}</strong> blocked from rollback (check details below).</>
            )}
          </p>
        )}

        {isRolledBack && (job.blocked?.length ?? 0) > 0 && (
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">View {job.blocked!.length} blocked row(s)</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {job.blocked!.map((b, i) => (
                <li key={i} className="font-mono text-xs">
                  {('id' in b ? b.id : b.memberId).slice(0, 8)}…: {b.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        {job.errors.length > 0 && (
          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">View {job.errors.length} issue(s)</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {job.errors.map((e, i) => (
                <li key={i} className="font-mono">
                  {e.row > 0 ? `row ${e.row}: ` : 'file: '}{e.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex justify-end gap-3">
          <Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button>
          <Button variant="outline" onClick={onStartOver}>Import another file</Button>
          {isCommitted && (job.created_member_ids?.length ?? 0) > 0 && (
            <Button variant="destructive" onClick={onRollback}>
              <RotateCcw className="mr-2 h-4 w-4" /> Roll back
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({ label, value, valueClass = '' }: { label: string; value: number; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
