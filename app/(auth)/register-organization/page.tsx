'use client';

import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
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
import { OrganizationSignupEmailSchema, RegisterOrganizationSchema } from '@/lib/validators/auth.schema';
import { getErrorMessage } from '@/lib/utils';
import { ORGANIZATION_TYPES, ORGANIZATION_TYPE_LABELS, ORGANIZATION_PLAN_MONTHLY_FEES } from '@/types/enums';

const schema = RegisterOrganizationSchema.extend({ confirm: z.string() }).refine(
  (value) => value.password === value.confirm,
  {
    message: 'Passwords do not match',
    path: ['confirm'],
  },
);

type FormValues = z.input<typeof schema>;

export default function RegisterOrganizationPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState<string>();

  const {
    register,
    handleSubmit,
    control,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { planType: 'starter' },
  });

  const email = useWatch({ control, name: 'email' });
  const codeSent = Boolean(codeSentTo && codeSentTo === email?.trim().toLowerCase());

  async function sendCode() {
    const input = OrganizationSignupEmailSchema.safeParse({ email });
    if (!input.success) {
      setError('email', { message: 'Enter a valid work email.' });
      return;
    }
    clearErrors('email');
    setSendingCode(true);
    try {
      await authApi.sendOrganizationSignupCode(input.data.email);
      setCodeSentTo(input.data.email);
    } catch (error) {
      toast({
        title: 'Could not send your verification code',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setSendingCode(false);
    }
  }

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
        planType: 'starter',
        verificationCode: values.verificationCode,
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
          Set up a workspace for your NGO, SACCO, foundation or other institution. Verify your work email to get
          started.
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
                {...register('organizationType')}
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

          <div className="rounded-lg border p-4 text-sm">
            <h3 className="font-semibold">Enterprise Starter</h3>
            <p className="mt-1 text-muted-foreground">
              KES {ORGANIZATION_PLAN_MONTHLY_FEES.starter.toLocaleString('en-KE')} per month. Includes up to five linked
              groups, two staff seats and one active funding programme.
            </p>
            <Link
              href="/contact"
              className="mt-2 inline-block font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              Ask about other plans
            </Link>
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
              <Input id="phone" type="tel" autoComplete="tel" {...register('phone')} placeholder="07XXXXXXXX" />
              {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="min-w-48 flex-1"
                  {...register('email')}
                />
                <Button type="button" variant="outline" onClick={sendCode} disabled={sendingCode}>
                  {sendingCode ? 'Sending…' : codeSent ? 'Resend code' : 'Send code'}
                </Button>
              </div>
              {errors.email && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
              {codeSent && (
                <p role="status" className="text-sm text-muted-foreground">
                  Check your inbox for the six-digit code.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verificationCode">Email verification code</Label>
              <Input
                id="verificationCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                {...register('verificationCode')}
              />
              {errors.verificationCode && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.verificationCode.message}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
                {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submitting || sendingCode}>
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
