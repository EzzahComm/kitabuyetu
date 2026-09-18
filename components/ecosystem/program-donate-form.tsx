'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface ProgramDonateFormProps {
  programId: string;
  programName: string;
  onSuccess?: () => void;
}

export function ProgramDonateForm({ programId, programName, onSuccess }: ProgramDonateFormProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [checking, setChecking] = useState(false);
  const [formData, setFormData] = useState({
    phone: '',
    amount: '',
    donorName: '',
    message: '',
    isAnonymous: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Initiate STK push
      const response = await fetch(`/api/v1/donations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          programId,
          phone: formData.phone,
          amount: parseFloat(formData.amount),
          donorName: formData.isAnonymous ? undefined : formData.donorName || 'Anonymous',
          message: formData.message || undefined,
          isAnonymous: formData.isAnonymous,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to initiate donation');
      }

      const { donation } = await response.json();
      toast({ title: 'M-Pesa prompt sent!', description: 'Complete the payment on your phone.' });

      // Poll for completion
      setChecking(true);
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes (5s per check)

      const pollCompletion = async () => {
        while (attempts < maxAttempts) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

          const checkResponse = await fetch(`/api/v1/donations/${donation.id}`);
          if (checkResponse.ok) {
            const updated = await checkResponse.json();
            if (updated.donation.status === 'completed') {
              toast({ title: 'Donation received!', description: 'Thank you for your support.' });
              setFormData({ phone: '', amount: '', donorName: '', message: '', isAnonymous: false });
              setShowForm(false);
              setChecking(false);
              onSuccess?.();
              return;
            }
          }
        }

        setChecking(false);
        toast({ title: 'Waiting for confirmation', description: 'You can close this window.' });
      };

      pollCompletion();
    } catch (error) {
      setChecking(false);
      toast({ variant: 'destructive', title: 'Error', description: error instanceof Error ? error.message : 'Failed to process donation' });
    } finally {
      setLoading(false);
    }
  };

  if (!showForm) {
    return (
      <Button
        onClick={() => setShowForm(true)}
        className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-medium py-3 px-4 rounded-lg transition text-base"
      >
        Support {programName}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-gray-50 p-6 rounded-lg">
      <h3 className="font-semibold text-gray-900 mb-4">Make a Donation</h3>

      <div>
        <label className="block text-sm font-medium mb-1">Phone Number (M-Pesa) *</label>
        <Input
          type="tel"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          placeholder="e.g., 254712345678"
          pattern="^254[0-9]{9}$"
          required
          disabled={checking}
        />
        <p className="text-xs text-gray-500 mt-1">Format: 254XXXXXXXXX</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Amount (KES) *</label>
        <Input
          type="number"
          name="amount"
          value={formData.amount}
          onChange={handleChange}
          placeholder="e.g., 500"
          min="10"
          max="500000"
          required
          disabled={checking}
        />
        <p className="text-xs text-gray-500 mt-1">Min: KES 10 | Max: KES 500,000</p>
      </div>

      <div>
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            name="isAnonymous"
            checked={formData.isAnonymous}
            onChange={handleChange}
            disabled={checking}
            className="w-4 h-4"
          />
          <span className="text-sm">Donate anonymously</span>
        </label>
      </div>

      {!formData.isAnonymous && (
        <div>
          <label className="block text-sm font-medium mb-1">Your Name</label>
          <Input
            type="text"
            name="donorName"
            value={formData.donorName}
            onChange={handleChange}
            placeholder="Your name (optional)"
            disabled={checking}
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Message</label>
        <Textarea
          name="message"
          value={formData.message}
          onChange={handleChange}
          placeholder="Share why you're supporting this program (optional)"
          rows={2}
          disabled={checking}
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={loading || checking}
          className="flex-1 bg-green-600 hover:bg-green-700"
        >
          {checking ? 'Waiting for payment...' : loading ? 'Processing...' : 'Donate Now'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!checking) {
              setShowForm(false);
              setFormData({ phone: '', amount: '', donorName: '', message: '', isAnonymous: false });
            }
          }}
          disabled={checking}
        >
          Cancel
        </Button>
      </div>

      {checking && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-700">
          Complete the M-Pesa payment on your phone. This window will close automatically when confirmed.
        </div>
      )}
    </form>
  );
}
