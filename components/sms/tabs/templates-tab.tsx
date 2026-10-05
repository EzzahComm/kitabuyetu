'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TemplateCreatePayload } from '@/lib/validators/sms.schema';
import { smsApi } from '@/lib/api/endpoints';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { ExpandableText } from '@/components/shared/expandable-text';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { countSegments } from '@/lib/sms/segments';
import { SectionHeader } from '@/components/shared/dashboard-sections';
import type { SmsTemplate } from '@/types/api.types';
import { CategoryBadge } from './helpers';

export function TemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<TemplateCreatePayload['category']>('custom');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => smsApi.templates(),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (b: TemplateCreatePayload) => smsApi.createTemplate(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast({ title: 'Template created' });
      setShowForm(false);
      setKey('');
      setName('');
      setBody('');
    },
    onError: (e) => toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) }),
  });

  const del = useMutation({
    mutationFn: (id: string) => smsApi.deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms-templates'] });
      toast({ title: 'Template deleted' });
    },
  });

  const templates: SmsTemplate[] = data ?? [];
  const bodySeg = countSegments(body);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="SMS Templates"
        action={
          <Button type="button" size="sm" className="text-xs" onClick={() => setShowForm(!showForm)}>
            <Plus size={13} /> New Template
          </Button>
        }
      />

      {showForm && (
        <div className="bg-card rounded-xl border p-5 space-y-3">
          <h3 className="text-sm font-medium">New Template</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="template-key-snake-case" className="text-xs text-muted-foreground block mb-1">
                Key (snake_case)
              </label>
              <input
                id="template-key-snake-case"
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-ring"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s/g, '_'))}
                placeholder="my_template"
              />
            </div>
            <div>
              <label htmlFor="template-display-name" className="text-xs text-muted-foreground block mb-1">
                Display Name
              </label>
              <input
                id="template-display-name"
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-ring"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Template"
              />
            </div>
          </div>
          <div>
            <label htmlFor="template-category" className="text-xs text-muted-foreground block mb-1">
              Category
            </label>
            <select
              id="template-category"
              aria-label="Template category"
              className="w-full text-sm border rounded-lg px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCreatePayload['category'])}
            >
              {['transaction', 'loan', 'reminder', 'birthday', 'onboarding', 'auth', 'announcement', 'custom'].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Body <span className="text-muted-foreground">(use {'{{variable}}'} for placeholders)</span>
            </label>
            <textarea
              className="w-full text-sm border rounded-lg px-3 py-2 resize-none focus:outline-hidden focus:ring-2 focus:ring-ring"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {{first_name}}, your balance is KES {{amount}}."
            />
            <p className="text-xs text-muted-foreground mt-1">
              {bodySeg.characters} chars · {bodySeg.segments} SMS part{bodySeg.segments > 1 ? 's' : ''}
              {bodySeg.encoding === 'ucs2' ? ' · unicode' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => create.mutate({ templateKey: key, name, body, category })}
              disabled={!key || !name || !body}
              loading={create.isPending}
            >
              {create.isPending ? 'Saving…' : 'Save Template'}
            </Button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <PaginatedTable
        data={singlePage(templates)}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onPageChange={() => {}}
        emptyMessage="No templates yet"
        columns={[
          { key: 'name', header: 'Name', render: (t) => <span className="font-medium text-foreground">{t.name}</span> },
          {
            key: 'key',
            header: 'Key',
            render: (t) => <span className="font-mono text-xs text-muted-foreground">{t.template_key}</span>,
          },
          { key: 'category', header: 'Category', render: (t) => <CategoryBadge category={t.category} /> },
          {
            key: 'variables',
            header: 'Variables',
            render: (t) => (
              <span className="text-xs text-muted-foreground">{(t.variables ?? []).join(', ') || '—'}</span>
            ),
          },
          {
            key: 'body',
            header: 'Body',
            className: 'max-w-[280px]',
            render: (t) => <ExpandableText className="text-muted-foreground text-xs">{t.body}</ExpandableText>,
          },
          {
            key: 'type',
            header: 'Type',
            render: (t) => (
              <span className={`text-xs ${t.is_system ? 'text-blue-500' : 'text-muted-foreground'}`}>
                {t.is_system ? 'System' : 'Custom'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (t) =>
              !t.is_system ? (
                <button
                  type="button"
                  onClick={() => del.mutate(t.id)}
                  aria-label="Delete template"
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
