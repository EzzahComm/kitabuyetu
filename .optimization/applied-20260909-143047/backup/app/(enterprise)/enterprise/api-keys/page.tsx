'use client';

import * as React from 'react';
import { KeyRound, Plus, Copy, Check, Webhook, Trash2, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
// Intentionally still mock — no API key issuance / webhook delivery backend
// exists yet. Out of scope for the portfolio/branches "quick win" wiring.
import { apiKeys as seedKeys, webhooks as seedHooks, type ApiKey } from '../../_data';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const randomToken = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export default function ApiKeysPage() {
  const [keys, setKeys] = React.useState<ApiKey[]>(seedKeys);
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKey | null>(null);

  // Create-key flow state (kept in the page so a fresh "Create key" click resets it).
  const [createOpen, setCreateOpen] = React.useState(false);
  const [step, setStep] = React.useState<'form' | 'reveal'>('form');
  const [name, setName] = React.useState('');
  const [generated, setGenerated] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  function startCreate() {
    setName('');
    setStep('form');
    setGenerated('');
    setCopied(false);
    setCreateOpen(true);
  }

  function generate() {
    const full = `ky_live_${randomToken(28)}`;
    setGenerated(full);
    setStep('reveal');
    setKeys((prev) => [
      { id: `k${Date.now()}`, name: name.trim() || 'Untitled key', prefix: full.slice(0, 12), scopes: ['read', 'write'], created: 'just now', lastUsed: 'never', status: 'active' },
      ...prev,
    ]);
  }

  async function copyKey() {
    try { await navigator.clipboard.writeText(generated); } catch { /* clipboard may be blocked */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function revoke() {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: 'revoked' } : k)));
    setRevokeTarget(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API & Webhooks"
        description="Programmatic access to your portfolio — manage keys and event subscriptions"
        breadcrumbs={[{ label: 'Developer', href: '/enterprise' }, { label: 'API & Webhooks' }]}
      />

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys"><KeyRound size={14} className="mr-1.5" /> API Keys</TabsTrigger>
          <TabsTrigger value="webhooks"><Webhook size={14} className="mr-1.5" /> Webhooks</TabsTrigger>
        </TabsList>

        {/* API KEYS */}
        <TabsContent value="keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Keys carry the permissions of their scopes. Treat them like passwords.</p>
            <Button size="sm" onClick={startCreate}><Plus className="h-4 w-4" /> Create key</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <PaginatedTable<ApiKey>
                data={singlePage(keys)}
                isLoading={false}
                onPageChange={() => {}}
                emptyMessage="No API keys yet"
                columns={[
                  {
                    key: 'name', header: 'Name',
                    render: (k) => (
                      <>
                        <p className="font-medium text-foreground">{k.name}</p>
                        <p className="text-xs text-muted-foreground">Created {k.created}</p>
                      </>
                    ),
                  },
                  { key: 'key', header: 'Key', render: (k) => <span className="font-mono text-xs text-muted-foreground">{k.prefix}••••••••</span> },
                  {
                    key: 'scopes', header: 'Scopes', className: 'hidden md:table-cell',
                    render: (k) => (
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
                      </div>
                    ),
                  },
                  { key: 'lastUsed', header: 'Last used', className: 'hidden sm:table-cell', render: (k) => <span className="text-muted-foreground">{k.lastUsed}</span> },
                  {
                    key: 'status', header: 'Status',
                    render: (k) => <StatusPill status={k.status} tone={k.status === 'active' ? 'positive' : 'neutral'} label={k.status} size="sm" />,
                  },
                  {
                    key: 'actions', header: '', className: 'text-right',
                    render: (k) => k.status === 'active' ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setRevokeTarget(k)}>
                        <Trash2 size={13} className="mr-1" /> Revoke
                      </Button>
                    ) : null,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* WEBHOOKS */}
        <TabsContent value="webhooks" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">We POST events to these endpoints. Failing endpoints retry with backoff.</p>
            <Button size="sm"><Plus className="h-4 w-4" /> Add endpoint</Button>
          </div>

          <div className="space-y-3">
            {seedHooks.map((h) => (
              <Card key={h.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-foreground">{h.url}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {h.events.map((e) => <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusPill status={h.status} tone={h.status === 'active' ? 'positive' : 'negative'} label={h.status} size="sm" />
                      <span className="text-[11px] text-muted-foreground">Last: {h.lastDelivery}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create-key dialog: form → reveal-once */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          {step === 'form' ? (
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Give the key a name so you can recognise it later.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label htmlFor="key-name" className="text-sm font-medium">Key name</label>
                <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production server" autoFocus />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={generate}>Generate key</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Copy your API key</DialogTitle>
                <DialogDescription>This is the only time we&apos;ll show the full key. Store it securely.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                <code className="flex-1 truncate font-mono text-xs">{generated}</code>
                <Button size="sm" variant="outline" onClick={copyKey}>
                  {copied ? <><Check size={14} className="mr-1 text-brand-600" /> Copied</> : <><Copy size={14} className="mr-1" /> Copy</>}
                </Button>
              </div>
              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>If you lose it, revoke this key and create a new one — it can&apos;t be recovered.</span>
              </div>
              <DialogFooter>
                <Button onClick={() => setCreateOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        variant="danger"
        title={`Revoke "${revokeTarget?.name}"?`}
        description="Any integration using this key will immediately stop working. This cannot be undone."
        confirmLabel="Revoke key"
        onConfirm={revoke}
      />
    </div>
  );
}
