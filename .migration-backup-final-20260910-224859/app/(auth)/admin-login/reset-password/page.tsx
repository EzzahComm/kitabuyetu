'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { ArrowLeft, Shield, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api/endpoints';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';

const passwordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Must contain an uppercase letter')
               .regex(/[0-9]/, 'Must contain a number'),
});
type PasswordValues = z.infer<typeof passwordSchema>;

/**
 * Staff/backoffice reset-password — the link target from the email
 * admin-password-reset.service.ts sends. The token in the URL IS the proof
 * of possession, mirroring accept-org-invite's shape: this page takes no
 * session and re-authenticates nothing, just the token + new password.
 */
function ResetPasswordBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = async (values: PasswordValues) => {
    try {
      await authApi.adminForgotPasswordReset({ token, password: values.password });
      setDone(true);
      toast({ title: 'Password reset', description: 'You can now sign in with your new password.' });
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Could not reset password',
        description: getErrorMessage(err),
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <Link href="/admin-login" className="inline-flex items-center gap-1 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
          <span className="font-mono text-xs">staff portal</span>
        </div>

        <Card className="border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              <CardTitle className="text-slate-100">
                {done ? 'Password reset' : 'Choose a new password'}
              </CardTitle>
            </div>
            {!done && (
              <CardDescription className="text-slate-400">
                {token
                  ? 'This link is single-use and expires 30 minutes after it was sent.'
                  : 'This link is missing its token — request a new one below.'}
              </CardDescription>
            )}
          </CardHeader>

          <CardContent>
            {done ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                <Button onClick={() => router.replace('/admin-login')} className="w-full bg-red-600 hover:bg-red-700">
                  Back to sign in
                </Button>
              </div>
            ) : !token ? (
              <Link href="/admin-login/forgot-password">
                <Button className="w-full bg-red-600 hover:bg-red-700">Request a new link</Button>
              </Link>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-slate-300">New password</Label>
                  <div className="relative">
                    <Input
                      id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" autoFocus
                      className="bg-slate-950 border-slate-800 pr-10 text-slate-100"
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <Button type="submit" disabled={form.formState.isSubmitting} className="w-full bg-red-600 hover:bg-red-700">
                  {form.formState.isSubmitting ? 'Resetting…' : 'Reset password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordBody />
    </Suspense>
  );
}
