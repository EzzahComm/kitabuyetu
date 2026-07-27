'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Download, FileText, Loader2, RotateCcw,
  Upload, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError } from '@/lib/api/client';
import { downloadAuthenticated } from '@/lib/utils/download';

/**
 * Bulk-import wizard for members. Three states drive the UI:
 *   idle      → drag-drop a CSV (or click to browse)
 *   preview   → server has parsed the file; user reviews row-by-row before
 *               confirming or discarding
 *   result    → import committed; show summary + (admin-only) rollback
 *
 * The component intentionally keeps its own state machine instead of using
 * a router-driven flow because the preview rows live server-side in the
 * import_jobs row and the page only needs the current job's id.
 */

interface ImportRowError { row: number; message: string; raw?: Record<string, string> }
interface PreparedRow {
  row_num:           number;
  phone:             string;
  first_name:        string;
  middle_name:       string | null;
  last_name:         string;
  email:             string | null;
  county_id:         string | null;
  occupation:        string | null;
  role:              string;
  joined_at:         string | null;
  warnings:          string[];
}
interface ImportJob {
  id:                 string;
  status:             'previewed' | 'committed' | 'cancelled' | 'rolled_back' | 'failed';
  filename:           string | null;
  total_rows:         number;
  valid_rows:         number;
  error_rows:         number;
  errors:             ImportRowError[];
  preview_rows?:      PreparedRow[];
  created_member_ids: string[];
  imported?:          number;
  skipped?:           number;
  deleted?:           number;
  blocked?:           { memberId: string; reason: string }[];
}

type Phase = 'idle' | 'uploading' | 'preview' | 'committing' | 'result';

const PREVIEW_VISIBLE_ROWS = 25;

export default function MembersImportPage() {
  const [phase, setPhase]   = useState<Phase>('idle');
  const [job,   setJob]     = useState<ImportJob | null>(null);
  const { toast }           = useToast();

  // ── Upload & preview ───────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ variant: 'destructive', title: 'CSV only', description: 'Excel (.xlsx) support is coming in a follow-up phase. Save as CSV and try again.' });
      return;
    }
    setPhase('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload<ImportJob>('/import/preview?type=members', formData);
      setJob(result);
      setPhase('preview');
    } catch (err) {
      setPhase('idle');
      const msg = err instanceof ApiError ? err.message : 'Upload failed';
      toast({ variant: 'destructive', title: 'Upload failed', description: msg });
    }
  }, [toast]);

  // ── Commit / discard ───────────────────────────────────────────────────

  const commit = async () => {
    if (!job) return;
    setPhase('committing');
    try {
      const result = await api.post<ImportJob>(`/import/${job.id}/commit`, {});
      setJob(result);
      setPhase('result');
      toast({ title: 'Import committed', description: `${result.imported ?? 0} member(s) added` });
    } catch (err) {
      setPhase('preview');
      const msg = err instanceof ApiError ? err.message : 'Commit failed';
      toast({ variant: 'destructive', title: 'Commit failed', description: msg });
    }
  };

  const discard = async () => {
    if (!job) return;
    try {
      await api.delete<void>(`/import/${job.id}`);
      toast({ title: 'Preview discarded' });
    } catch {
      // Cancel is best-effort — even if the call fails, the user wants out.
    }
    setJob(null);
    setPhase('idle');
  };

  const rollback = async () => {
    if (!job) return;
    if (!confirm('Roll back this import? This permanently removes the imported members from your group.')) return;
    try {
      const result = await api.post<ImportJob>(`/import/${job.id}/rollback`, { reason: 'User requested undo' });
      setJob(result);
      toast({ title: 'Import rolled back', description: `${result.deleted ?? 0} member(s) removed` });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Rollback failed';
      toast({ variant: 'destructive', title: 'Rollback failed', description: msg });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-3">
        <Link href="/members" className="text-muted-foreground hover:text-foreground mt-1">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <PageHeader className="flex-1" title="Import Members" />
      </div>

      {phase === 'idle' && <IdleView onUpload={uploadFile} />}

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
          <span className="text-muted-foreground">Adding members to your group…</span>
        </CardContent></Card>
      )}

      {phase === 'result' && job && (
        <ResultView job={job} onRollback={rollback} onStartOver={() => { setJob(null); setPhase('idle'); }} />
      )}
    </div>
  );
}

// ── Idle: drag-drop + template download ─────────────────────────────────

function IdleView({ onUpload }: { onUpload: (file: File) => void }) {
  const [drag, setDrag]         = useState(false);
  const [downloading, setDownloading] = useState(false);
  const inputEl                 = useRef<HTMLInputElement>(null);
  const { toast }               = useToast();

  const handleFile = (f: File | undefined) => { if (f) onUpload(f); };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      await downloadAuthenticated('/api/v1/import/template?type=members', {
        fallbackFilename: 'kitabuyetu-members-template.csv',
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not download template',
        description: (err as Error).message,
      });
    } finally {
      setDownloading(false);
    }
  };

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
            <p className="mt-3 font-medium">Drag &amp; drop your CSV here</p>
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
            Use the canonical column names. Headers are case-insensitive and accept common aliases
            (e.g. <code className="rounded bg-muted px-1">First Name</code>,
            <code className="ml-1 rounded bg-muted px-1">firstName</code>).
          </p>
          <p className="text-muted-foreground"><strong>Required:</strong> phone, first_name, last_name</p>
          <Button
            variant="outline"
            className="w-full"
            onClick={downloadTemplate}
            disabled={downloading}
          >
            {downloading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Downloading…</>
              : <><Download className="mr-2 h-4 w-4" /> Download template</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Preview: errors + sample rows + commit/discard CTAs ─────────────────

function PreviewView({ job, onCommit, onDiscard }: { job: ImportJob; onCommit: () => void; onDiscard: () => void }) {
  const rows = job.preview_rows ?? [];
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
          <CardContent>
            <PaginatedTable
              data={singlePage(visible.map((r) => ({ ...r, id: String(r.row_num) })))}
              isLoading={false}
              onPageChange={() => {}}
              emptyMessage="No rows to preview"
              columns={[
                { key: 'row_num', header: 'Row', render: (r) => <span className="font-mono text-xs">{r.row_num}</span> },
                { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono">{r.phone}</span> },
                { key: 'name', header: 'Name', render: (r) => [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ') },
                { key: 'role', header: 'Role', render: (r) => <Badge variant="secondary">{r.role}</Badge> },
                { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
                { key: 'occupation', header: 'Occupation', render: (r) => r.occupation ?? '—' },
                {
                  key: 'warnings', header: 'Warnings', render: (r) => (
                    r.warnings.length > 0
                      ? <span className="text-amber-600">{r.warnings.join('; ')}</span>
                      : <span className="text-muted-foreground">—</span>
                  ),
                },
              ]}
            />
            {hiddenCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">…and {hiddenCount} more row(s). They’ll all be imported on confirm.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onDiscard}>Discard</Button>
        <Button onClick={onCommit} disabled={job.valid_rows === 0}>
          Confirm import ({job.valid_rows} member{job.valid_rows === 1 ? '' : 's'})
        </Button>
      </div>
    </div>
  );
}

// ── Result: outcome + rollback CTA ──────────────────────────────────────

function ResultView({ job, onRollback, onStartOver }: { job: ImportJob; onRollback: () => void; onStartOver: () => void }) {
  const isCommitted  = job.status === 'committed';
  const isRolledBack = job.status === 'rolled_back';

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

        {isRolledBack && (job.deleted !== undefined) && (
          <p className="text-sm">
            Removed <strong>{job.deleted}</strong> member(s).
            {(job.blocked?.length ?? 0) > 0 && (
              <> <strong>{job.blocked!.length}</strong> kept because they have dependent records (membership removed from this group).</>
            )}
          </p>
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
          <Button asChild variant="outline"><Link href="/members">Back to members</Link></Button>
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
