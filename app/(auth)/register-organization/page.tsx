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
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { ORGANIZATION_TYPES, ORGANIZATION_TYPE_LABELS, ORGANIZATION_PLAN_COPY } from '@/types/enums';

// Mirrors lib/validators/auth.schema.ts's RegisterOrganizationSchema —
// kept in sync manually, same convention as app/(auth)/register/page.tsx's
// own comment about its server-side counterpart.
const schema = z
  .object({
    organizationName: z.string().min(3, 'Organization name must be at least 3 characters'),
    organizationType: z.enum(ORGANIZATION_TYPES, { errorMap: () => ({ message: 'Choose the type of organization' }) }),
    registrationNumber: z.string().optional().or(z.literal('')),
    organizationPhone: z.string().optional().or(z.literal('')),
    organizationEmail: z.string().email('Invalid email').optional().or(z.literal('')),
    county: z.string().optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),

    planType: z.enum(['starter', 'growth', 'premium'], { errorMap: () => ({ message: 'Choose a plan' }) }),

    firstName: z.string().min(2, 'Required'),
    lastName: z.string().min(2, 'Required'),
    phone: z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Valid Kenyan phone required'),
    email: z.string().email('A work email is required to sign in to the Enterprise portal'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Needs an uppercase letter')
      .regex(/[0-9]/, 'Needs a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type FormValues = z.infer<typeof schema>;

// premium_plus is deliberately excluded — it requires custom hand-negotiated
// terms (organization-plan.service.ts), so it stays a "Talk to us" sales
// conversation, not a self-serve option.
const SELF_SERVE_PLANS = ORGANIZATION_PLAN_COPY.filter((p) => p.type !== 'premium_plus');

export default function RegisterOrganizationPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { planType: 'starter' },
  });

  const planType = watch('planType');
  const organizationType = watch('organizationType');

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const result = await authApi.registerOrganization({
        organizationName: values.organizationName,
        organizationType: values.organizationType,
        registrationNumber: values.registrationNumber || undefined,
        organizationPhone: values.organizationPhone || undefined,
        organizationEmail: values.organizationEmail || undefined,
        county: values.county || undefined,
        address: values.address || undefined,
        planType: values.planType,
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        email: values.email,
        password: values.password,
      });
      toast({
        title: `${result.organizationName} is set up`,
        description: 'Sign in to the Enterprise portal to finish setting up your account.',
      });
      router.push('/enterprise/login');
    } catch (err) {
      toast({
        title: 'Could not create your organization',
        description: err instanceof ApiError ? err.message : getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Set up your Enterprise account</CardTitle>
        <CardDescription>
          For institutions overseeing multiple groups — SACCOs, NGOs, foundations and other organizations. Your
          account is active immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Organization</h3>
            <div className="space-y-1.5">
              <Label htmlFor="organizationName">Organization name</Label>
              <Input id="organizationName" {...register('organizationName')} />
              {errors.organizationName && <p className="text-sm text-destructive">{errors.organizationName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="organizationType">Type</Label>
              <select
                id="organizationType"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={organizationType ?? ''}
                onChange={(e) => setValue('organizationType', e.target.value as FormValues['organizationType'])}
              >
                <option value="">— Select —</option>
                {ORGANIZATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ORGANIZATION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {errors.organizationType && <p className="text-sm text-destructive">{errors.organizationType.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="registrationNumber">Registration number (optional)</Label>
              <Input id="registrationNumber" {...register('registrationNumber')} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Plan</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {SELF_SERVE_PLANS.map((p) => (
                <label
                  key={p.type}
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    planType === p.type ? 'border-brand-500 ring-1 ring-brand-500' : 'border-input'
                  }`}
                >
                  <input type="radio" value={p.type} className="sr-only" {...register('planType')} />
                  <div className="font-semibold">{p.label}</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {p.features.slice(0, 3).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </label>
              ))}
            </div>
            {errors.planType && <p className="text-sm text-destructive">{errors.planType.message}</p>}
            <p className="text-xs text-muted-foreground">
              Need Premium+ or custom terms?{' '}
              <Link href="/enterprise-solutions" className="font-medium text-brand-600 hover:underline">
                Talk to us
              </Link>{' '}
              instead.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Your account (first coordinator)</h3>
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
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              <p className="text-xs text-muted-foreground">
                The Enterprise portal signs in by email, with mandatory two-factor authentication.
              </p>
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
            {submitting ? 'Creating your organization…' : 'Create organization'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an Enterprise account?{' '}
            <Link href="/enterprise/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
