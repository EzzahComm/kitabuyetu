'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';

// Mirrors lib/validators/auth.schema.ts AdminLoginSchema.
const schema = z.object({
  email:    z.string().email('Enter a valid work email'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

/**
 * Backoffice login (super_admin / support / ngo_coordinator).
 *
 * Separate URL from the consumer /login on purpose — Phase 1 of the
 * backoffice isolation effort. The token issued here has `aud:
 * "backoffice"` and only works on /api/admin/*. The consumer login
 * issues `aud: "tenant"` tokens that the proxy rejects on /api/admin/*.
 *
 * Visual treatment is intentionally distinct (slate / dark) so staff
 * know they're entering a privileged context.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const { loginAdmin, user, audience } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  // If they're already signed in to the backoffice, bounce them in.
  useEffect(() => {
    if (user && audience === 'backoffice') {
      router.replace('/admin');
    }
  }, [user, audience, router]);

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const data = await authApi.adminLogin(values);
      loginAdmin(data);
      router.replace('/admin');
    } catch (err) {
      toast({
        variant:     'destructive',
        title:       'Sign-in failed',
        description: (err as Error).message ?? 'Invalid credentials',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-400">
          <Link href="/login" className="inline-flex items-center gap-1 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" /> Back to member login
          </Link>
          <span className="font-mono text-xs">staff portal</span>
        </div>

        <Card className="border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-500" />
              <CardTitle className="text-slate-100">Backoffice sign-in</CardTitle>
            </div>
            <CardDescription className="text-slate-400">
              For Kitabu Yetu staff only. Member accounts log in at
              {' '}
              <Link href="/login" className="text-slate-200 underline-offset-2 hover:underline">
                /login
              </Link>.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-slate-300">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@kitabuyetu.co.ke"
                  className="bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-600"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-red-400">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-slate-300">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="bg-slate-950 border-slate-800 text-slate-100"
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-xs text-red-400">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500">
          Activity in this portal is logged. Unauthorised access is prosecutable.
        </p>
      </div>
    </div>
  );
}
