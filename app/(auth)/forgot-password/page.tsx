'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { authApi } from '@/lib/api/endpoints';
import { getErrorMessage } from '@/lib/utils';

type Step = 'phone' | 'reset';

const phoneSchema = z.object({
  phone: z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number'),
});
type PhoneFormValues = z.infer<typeof phoneSchema>;

const resetSchema = z.object({
  otp:      z.string().length(6, 'Enter the 6-digit code'),
  password: z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Must contain an uppercase letter')
               .regex(/[0-9]/, 'Must contain a number'),
});
type ResetFormValues = z.infer<typeof resetSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [step, setStep]   = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const phoneForm = useForm<PhoneFormValues>({ resolver: zodResolver(phoneSchema) });
  const resetForm = useForm<ResetFormValues>({ resolver: zodResolver(resetSchema) });

  const requestCode = async (values: PhoneFormValues) => {
    try {
      await authApi.forgotPasswordStart(values.phone);
      setPhone(values.phone);
      setStep('reset');
      toast({ title: 'Code sent', description: `If ${values.phone} has an account, a code was sent to it.` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not send code', description: getErrorMessage(err) });
    }
  };

  const resendCode = async () => {
    try {
      await authApi.forgotPasswordStart(phone);
      toast({ title: 'Code re-sent' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not resend code', description: getErrorMessage(err) });
    }
  };

  const submitReset = async (values: ResetFormValues) => {
    try {
      await authApi.forgotPasswordReset({ phone, otp: values.otp, password: values.password });
      toast({ title: 'Password reset', description: 'You can now sign in with your new password.' });
      resetForm.reset();
      setStep('phone');
      phoneForm.reset();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not reset password', description: getErrorMessage(err) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>
          {step === 'phone'
            ? "Enter your phone number and we'll send you a reset code."
            : `Enter the 6-digit code sent to ${phone} and choose a new password.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 'phone' ? (
          <form onSubmit={phoneForm.handleSubmit(requestCode)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" placeholder="0712345678" {...phoneForm.register('phone')} />
              {phoneForm.formState.errors.phone && (
                <p className="text-xs text-destructive">{phoneForm.formState.errors.phone.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={phoneForm.formState.isSubmitting}>
              Send reset code
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-brand-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={resetForm.handleSubmit(submitReset)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input id="otp" inputMode="numeric" maxLength={6} placeholder="123456" {...resetForm.register('otp')} />
              {resetForm.formState.errors.otp && (
                <p className="text-xs text-destructive">{resetForm.formState.errors.otp.message}</p>
              )}
              <p className="text-xs text-muted-foreground">The code expires in 10 minutes.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pr-10"
                  {...resetForm.register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {resetForm.formState.errors.password && (
                <p className="text-xs text-destructive">{resetForm.formState.errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={resetForm.formState.isSubmitting}>
              Reset password
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={resendCode} className="text-brand-600 hover:underline">
                Resend code
              </button>
              <button
                type="button"
                onClick={() => { setStep('phone'); resetForm.reset(); }}
                className="text-muted-foreground hover:underline"
              >
                Use a different number
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
