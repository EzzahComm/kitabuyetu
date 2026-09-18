'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface OpportunityApplicationFormProps {
  opportunityId: string;
  groupName: string;
  groupMemberCount?: number;
  onSuccess?: () => void;
}

export function OpportunityApplicationForm({
  opportunityId,
  groupName,
  groupMemberCount,
  onSuccess,
}: OpportunityApplicationFormProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    contact_member_name: '',
    contact_member_phone: '',
    contact_member_email: '',
    message: '',
  });

  const { toast } = useToast();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`/api/v1/ecosystem/opportunities/${opportunityId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: groupName,
          group_member_count: groupMemberCount,
          ...formData,
        }),
      });

      if (!response.ok) throw new Error('Failed to submit application');

      toast({
        title: 'Application submitted',
        description: 'The partner will review your application and get back to you.',
      });

      setFormData({ contact_member_name: '', contact_member_phone: '', contact_member_email: '', message: '' });
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to submit application. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-900">Contact Person Name *</label>
        <Input
          name="contact_member_name"
          value={formData.contact_member_name}
          onChange={handleChange}
          required
          placeholder="Full name"
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Phone Number *</label>
        <Input
          name="contact_member_phone"
          value={formData.contact_member_phone}
          onChange={handleChange}
          required
          placeholder="+254..."
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Email Address</label>
        <Input
          name="contact_member_email"
          type="email"
          value={formData.contact_member_email}
          onChange={handleChange}
          placeholder="email@example.com"
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Message (Optional)</label>
        <Textarea
          name="message"
          value={formData.message}
          onChange={handleChange}
          placeholder="Tell the partner about your group and why you're interested..."
          rows={4}
          className="mt-1"
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Submitting...' : 'Apply Now'}
      </Button>
    </form>
  );
}
