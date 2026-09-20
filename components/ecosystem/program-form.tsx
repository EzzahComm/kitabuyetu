'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface ProgramFormProps {
  organizationId: string;
  onSuccess?: (program: unknown) => void;
}

export function ProgramForm({ organizationId, onSuccess }: ProgramFormProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    targetAmount: '',
    impactMetricName: '',
    impactMetricTarget: '',
    startDate: '',
    endDate: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      // Auto-generate slug from name
      ...(name === 'name' && { slug: value.toLowerCase().replace(/\s+/g, '-') }),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/v1/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          organizationId,
          targetAmount: formData.targetAmount ? parseFloat(formData.targetAmount) : undefined,
          impactMetricTarget: formData.impactMetricTarget ? parseFloat(formData.impactMetricTarget) : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create program');
      }

      const { program } = await response.json();
      toast({ title: 'Program created successfully' });

      setFormData({
        name: '',
        slug: '',
        description: '',
        targetAmount: '',
        impactMetricName: '',
        impactMetricTarget: '',
        startDate: '',
        endDate: '',
      });

      onSuccess?.(program);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: error instanceof Error ? error.message : 'Failed to create program' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div>
        <label className="block text-sm font-medium mb-2">Program Name *</label>
        <Input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="e.g., School Building Initiative"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">URL Slug *</label>
        <Input
          type="text"
          name="slug"
          value={formData.slug}
          onChange={handleChange}
          placeholder="auto-generated from name"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Description</label>
        <Textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Tell the story of this program..."
          rows={4}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Target Amount (KES)</label>
          <Input
            type="number"
            name="targetAmount"
            value={formData.targetAmount}
            onChange={handleChange}
            placeholder="e.g., 500000"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Impact Metric Name</label>
          <Input
            type="text"
            name="impactMetricName"
            value={formData.impactMetricName}
            onChange={handleChange}
            placeholder="e.g., Children Reached"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Metric Target</label>
          <Input
            type="number"
            name="impactMetricTarget"
            value={formData.impactMetricTarget}
            onChange={handleChange}
            placeholder="e.g., 100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Start Date</label>
          <Input
            type="date"
            name="startDate"
            value={formData.startDate}
            onChange={handleChange}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">End Date</label>
        <Input
          type="date"
          name="endDate"
          value={formData.endDate}
          onChange={handleChange}
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Creating...' : 'Create Program'}
      </Button>
    </form>
  );
}
