'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';

type PayoutMethod = 'phone' | 'paybill' | 'till';

// Mirrors lib/validators/campaign.schema.ts's RegisterCampaignSchema - kept
// in sync manually, same convention as register-organization/page.tsx's own
// comment about its server-side counterpart.
const schema = z
  .object({
    firstName: z.string().min(2, 'Required'),
    lastName: z.string().min(2, 'Required'),
    phone: z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Valid Kenyan phone required'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Needs an uppercase letter')
      .regex(/[0-9]/, 'Needs a number'),
    confirm: z.string(),

    title: z.string().min(3, 'Give your campaign a title').max(120),
    story: z.string().min(20, 'Tell donors at least a few sentences about this cause').max(10_000),
    targetAmount: z.coerce.number().positive('Enter a target amount').max(50_000_000),
    beneficiaryName: z.string().max(120).optional().or(z.literal('')),
    beneficiaryConsentConfirmed: z.boolean().optional(),

    payoutMethod: z.enum(['phone', 'paybill', 'till']),
    payoutPhone: z.string().optional().or(z.literal('')),
    payoutShortcode: z.string().optional().or(z.literal('')),
    payoutAccount: z.string().optional().or(z.literal('')),
    payoutPayeeName: z.string().optional().or(z.literal('')),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .superRefine((v, ctx) => {
    if (v.beneficiaryName?.trim() && !v.beneficiaryConsentConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beneficiaryConsentConfirmed'],
        message: 'Confirm the beneficiary has agreed to be named publicly',
      });
    }
    if (v.payoutMethod === 'phone' && !/^(?:\+254|0)[17]\d{8}$/.test(v.payoutPhone ?? '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payoutPhone'], message: 'Valid Kenyan phone required' });
    }
    if (v.payoutMethod !== 'phone') {
      if (!/^\d{5,7}$/.test(v.payoutShortcode ?? '')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payoutShortcode'], message: 'A 5-7 digit number' });
      }
      if (!v.payoutPayeeName || v.payoutPayeeName.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payoutPayeeName'], message: 'Enter the business name' });
      }
    }
    if (v.payoutMethod === 'paybill' && !v.payoutAccount?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payoutAccount'], message: 'Enter the account number' });
    }
  });

type FormValues = z.infer<typeof schema>;

function toPayoutPayload(v: FormValues) {
  if (v.payoutMethod === 'phone') return { method: 'phone' as const, phone: v.payoutPhone! };
  if (v.payoutMethod === 'paybill') {
    return {
      method: 'paybill' as const,
      shortcode: v.payoutShortcode!,
      account: v.payoutAccount!,
      payeeName: v.payoutPayeeName!,
    };
  }
  return { method: 'till' as const, shortcode: v.payoutShortcode!, payeeName: v.payoutPayeeName! };
}

export default function StartCampaignPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ groupCode: string; campaignSlug: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { payoutMethod: 'phone' },
  });

  const payoutMethod = watch('payoutMethod');
  const beneficiaryName = watch('beneficiaryName');

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const result = await authApi.registerCampaign({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        password: values.password,
        title: values.title,
        story: values.story,
        targetAmount: values.targetAmount,
        beneficiaryName: values.beneficiaryName || undefined,
        beneficiaryConsentConfirmed: values.beneficiaryConsentConfirmed,
        payout: toPayoutPayload(values),
      });
      setSubmitted({ groupCode: result.groupCode, campaignSlug: result.campaignSlug });
    } catch (err) {
      toast({
        title: 'Could not submit your campaign',
        description: err instanceof ApiError ? err.message : getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Campaign submitted</CardTitle>
          <CardDescription>Kitabu Yetu reviews every campaign before it goes public.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Your group code is <span className="font-mono font-semibold">{submitted.groupCode}</span> - keep it safe,
            you&apos;ll need it alongside your phone number and password to sign in later.
          </p>
          <p className="text-muted-foreground">
            We&apos;ll review your campaign shortly. Once approved, it goes live at{' '}
            <span className="font-mono">/fundraise/{submitted.campaignSlug}</span>.
          </p>
          <Button onClick={() => router.push('/fundraise')} className="w-full">
            Back to Changi$ha
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Start a Changi$ha campaign</CardTitle>
        <CardDescription>
          Raise money for a cause, a project or someone in need - by M-Pesa, in the open. We review every campaign
          before it goes live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Your campaign</h3>
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="e.g. Help rebuild the Kitui dispensary" {...register('title')} />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="story">Tell the story</Label>
              <Textarea id="story" rows={5} {...register('story')} />
              {errors.story && <p className="text-sm text-destructive">{errors.story.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetAmount">Target amount (KES)</Label>
              <Input id="targetAmount" type="number" min={1} {...register('targetAmount')} />
              {errors.targetAmount && <p className="text-sm text-destructive">{errors.targetAmount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="beneficiaryName">Beneficiary name (optional)</Label>
              <Input id="beneficiaryName" {...register('beneficiaryName')} />
              {beneficiaryName?.trim() && (
                <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
                  <input type="checkbox" className="mt-0.5" {...register('beneficiaryConsentConfirmed')} />
                  This person has agreed to be named publicly on this campaign
                </label>
              )}
              {errors.beneficiaryConsentConfirmed && (
                <p className="text-sm text-destructive">{errors.beneficiaryConsentConfirmed.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Where withdrawals are paid</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['phone', 'paybill', 'till'] as PayoutMethod[]).map((m) => (
                <label
                  key={m}
                  className={`cursor-pointer rounded-lg border p-3 text-sm capitalize ${
                    payoutMethod === m ? 'border-brand-500 ring-1 ring-brand-500' : 'border-input'
                  }`}
                >
                  <input type="radio" value={m} className="sr-only" {...register('payoutMethod')} />
                  {m === 'phone' ? 'M-Pesa phone' : m}
                </label>
              ))}
            </div>
            {payoutMethod === 'phone' && (
              <div className="space-y-1.5">
                <Label htmlFor="payoutPhone">M-Pesa phone number</Label>
                <Input id="payoutPhone" placeholder="07XXXXXXXX" {...register('payoutPhone')} />
                {errors.payoutPhone && <p className="text-sm text-destructive">{errors.payoutPhone.message}</p>}
              </div>
            )}
            {payoutMethod !== 'phone' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="payoutShortcode">
                    {payoutMethod === 'paybill' ? 'Paybill number' : 'Till number'}
                  </Label>
                  <Input id="payoutShortcode" {...register('payoutShortcode')} />
                  {errors.payoutShortcode && (
                    <p className="text-sm text-destructive">{errors.payoutShortcode.message}</p>
                  )}
                </div>
                {payoutMethod === 'paybill' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="payoutAccount">Account number</Label>
                    <Input id="payoutAccount" {...register('payoutAccount')} />
                    {errors.payoutAccount && <p className="text-sm text-destructive">{errors.payoutAccount.message}</p>}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="payoutPayeeName">Business name</Label>
                  <Input id="payoutPayeeName" {...register('payoutPayeeName')} />
                  {errors.payoutPayeeName && (
                    <p className="text-sm text-destructive">{errors.payoutPayeeName.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Your account</h3>
            <p className="text-xs text-muted-foreground">
              We use this to let you know how your campaign review is going, and so you can sign in later to manage it.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" {...register('firstName')} />
                {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" {...register('lastName')} />
                {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register('phone')} placeholder="07XXXXXXXX" />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register('password')} />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" {...register('confirm')} />
                {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Submitting your campaign…' : 'Submit for review'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already running a group on Kitabu Yetu?{' '}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>{' '}
            and create a campaign from your dashboard instead.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
