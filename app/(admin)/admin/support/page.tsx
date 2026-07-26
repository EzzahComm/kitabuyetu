'use client';

import { useState } from 'react';
import {
  Headphones, Search, Plus,
  Clock, CheckCircle2, AlertTriangle,
  MoreHorizontal, ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminTickets, useUpdateTicket, useCreateTicket } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { formatDate, getErrorMessage } from '@/lib/utils';

interface SupportTicketRow {
  id:             string;
  subject:        string;
  ticket_number:  string;
  group_name:     string | null;
  member_name:    string | null;
  priority:       string;
  status:         string;
  sla_breach_at:  string | undefined;
  comment_count:  number | null;
  created_at:     string;
}

const STATUS_VARIANT: Record<string, 'warning' | 'default' | 'secondary' | 'success'> = {
  open:        'warning',
  in_progress: 'default',
  waiting:     'secondary',
  resolved:    'success',
  closed:      'secondary',
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'text-red-700 bg-red-50 border-red-200',
  high:   'text-amber-700 bg-amber-50 border-amber-200',
  normal: 'text-blue-700 bg-blue-50 border-blue-200',
  low:    'text-gray-600 bg-gray-50 border-gray-200',
};

function SlaChip({ breachAt }: { breachAt?: string }) {
  if (!breachAt) return null;
  const overdue = new Date(breachAt) < new Date();
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${overdue ? 'text-red-700 bg-red-50 border-red-200' : 'text-green-700 bg-green-50 border-green-200'}`}>
      {overdue ? 'SLA BREACHED' : `SLA: ${formatDate(breachAt)}`}
    </span>
  );
}

export default function SupportPage() {
  const { toast } = useToast();
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [status,     setStatus]     = useState('');
  const [priority,   setPriority]   = useState('');
  const [resolveId,  setResolveId]  = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [newTicket,  setNewTicket]  = useState(false);
  const [form,       setForm]       = useState({
    subject: '', description: '', category: 'general', priority: 'normal',
  });

  const { data, isLoading } = useAdminTickets({ page, limit: 20, status, priority, search });
  const updateTicket = useUpdateTicket();
  const createTicket = useCreateTicket();

  const items: SupportTicketRow[] = data?.items ?? [];
  const total        = data?.total ?? 0;
  const totalPages   = Math.ceil(total / 20);

  const openCount       = items.filter((t) => t.status === 'open').length;
  const inProgressCount = items.filter((t) => t.status === 'in_progress').length;
  const slaBreached     = items.filter((t) => t.sla_breach_at && new Date(t.sla_breach_at) < new Date() && !['resolved','closed'].includes(t.status)).length;

  const handleResolve = async () => {
    if (!resolveId) return;
    try {
      await updateTicket.mutateAsync({ id: resolveId, status: 'resolved', resolution });
      toast({ title: 'Ticket resolved' });
      setResolveId(null); setResolution('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  const handleCreate = async () => {
    try {
      await createTicket.mutateAsync(form);
      toast({ title: 'Ticket created' });
      setNewTicket(false);
      setForm({ subject: '', description: '', category: 'general', priority: 'normal' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Headphones size={20} className="text-blue-500" />
            Support Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Triage, manage, and resolve customer support requests
          </p>
        </div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs"
          onClick={() => setNewTicket(true)}>
          <Plus size={14} className="mr-1" /> New Ticket
        </Button>
      </div>

      {/* Queue summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{openCount}</p>
          <p className="text-xs text-gray-500 mt-1">Open</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{inProgressCount}</p>
          <p className="text-xs text-gray-500 mt-1">In Progress</p>
        </div>
        <div className={`border rounded-xl p-4 text-center ${slaBreached > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
          <p className={`text-2xl font-bold ${slaBreached > 0 ? 'text-red-600' : 'text-gray-400'}`}>{slaBreached}</p>
          <p className="text-xs text-gray-500 mt-1">SLA Breached</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search by subject or ticket #…"
                className="pl-8 h-8 text-sm"
              />
            </div>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background">
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting">Waiting</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}
              className="h-8 text-sm border border-input rounded-md px-2 bg-background">
              <option value="">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            {(search || status || priority) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setSearch(''); setStatus(''); setPriority(''); setPage(1); }}>
                Clear
              </Button>
            )}
            <span className="ml-auto text-xs text-gray-400">{total} tickets</span>
          </div>
        </CardContent>
      </Card>

      {/* Tickets table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Ticket</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Organization</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Priority</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">SLA</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Replies</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}>{[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                  ))}</tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                  No tickets found
                </td></tr>
              ) : items.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900 max-w-[280px] truncate">{ticket.subject}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{ticket.ticket_number}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{ticket.group_name ?? ticket.member_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border capitalize ${PRIORITY_CLASS[ticket.priority] ?? ''}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[ticket.status] ?? 'secondary'} className="text-xs capitalize">
                      {ticket.status?.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <SlaChip breachAt={ticket.sla_breach_at} />
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">{ticket.comment_count ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(ticket.created_at)}</td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!['resolved','closed'].includes(ticket.status) && (
                          <>
                            <DropdownMenuItem onClick={async () => {
                              await updateTicket.mutateAsync({ id: ticket.id, status: 'in_progress' });
                            }}>
                              <Clock size={13} className="mr-2" /> Mark In Progress
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setResolveId(ticket.id)}>
                              <CheckCircle2 size={13} className="mr-2 text-green-600" /> Resolve
                            </DropdownMenuItem>
                          </>
                        )}
                        {!['closed'].includes(ticket.status) && (
                          <DropdownMenuItem onClick={async () => {
                            await updateTicket.mutateAsync({ id: ticket.id, status: 'closed' });
                          }}>
                            Close ticket
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Resolve dialog */}
      <Dialog open={!!resolveId} onOpenChange={() => { setResolveId(null); setResolution(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Resolve Ticket</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Resolution note (sent to customer)</Label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={4}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Describe the resolution or action taken…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResolveId(null); setResolution(''); }}>Cancel</Button>
            <Button onClick={handleResolve} loading={updateTicket.isPending}
              className="bg-green-600 hover:bg-green-700">
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New ticket dialog */}
      <Dialog open={newTicket} onOpenChange={setNewTicket}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Support Ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Brief description of the issue" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Category</Label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="general">General</option>
                  <option value="billing">Billing</option>
                  <option value="technical">Technical</option>
                  <option value="account">Account</option>
                  <option value="feature_request">Feature Request</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Detailed description of the issue…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTicket(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={createTicket.isPending}
              disabled={!form.subject || !form.description}>
              Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
