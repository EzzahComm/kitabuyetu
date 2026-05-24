'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { isGroupSelectionNeeded } from '@/types/api.types';
import type { NeedsGroupSelection } from '@/types/api.types';

// Mirrors LoginSchema in lib/validators/auth.schema.ts. Phone OR email; no
// group dropdown — the server resolves single-group memberships automatically
// and prompts for selection only when the member is in multiple groups.
const schema = z.object({
  identifier: z.string().min(1, 'Phone number or email is required'),
  password:   z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useAuth();
  const { toast } = useToast();

  // When the member is in multiple groups, the API responds with this list
  // and we render a chooser instead of redirecting.
  const [pendingGroups, setPendingGroups] = useState<NeedsGroupSelection['groups'] | null>(null);
  const [submitting,    setSubmitting]    = useState(false);

  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  // Shared submit — pass `groupCode` to disambiguate after the user picks a group.
  const submitWith = async (values: FormValues, groupCode?: string) => {
    setSubmitting(true);
    try {
      const result = await authApi.login({ ...values, groupCode });
      if (isGroupSelectionNeeded(result)) {
        setPendingGroups(result.groups);
        return;
      }
      login(result);
      router.push('/dashboard');
    } catch (err: any) {
      const code = err?.code ? ` (${err.code})` : '';
      toast({
        variant:     'destructive',
        title:       'Sign in failed',
        description: `${err?.message ?? 'Unknown error'}${code}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onPickGroup = (groupCode: string) => {
    void submitWith(getValues(), groupCode);
  };

  // ── Multi-group chooser ────────────────────────────────────────────────
  if (pendingGroups) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose a group</CardTitle>
          <CardDescription>
            You belong to {pendingGroups.length} groups. Pick the one you want to sign into.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingGroups.map((g) => (
            <button
              key={g.groupCode}
              type="button"
              onClick={() => onPickGroup(g.groupCode)}
              disabled={submitting}
              className="w-full text-left rounded-lg border border-input bg-background hover:bg-accent hover:border-brand-500 transition-colors px-4 py-3 disabled:opacity-50"
            >
              <p className="text-sm font-semibold text-brand-blue-500">{g.groupName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {g.groupCode} · {g.officerRole ?? g.groupRole.replace('_', ' ')}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPendingGroups(null)}
            className="text-sm text-muted-foreground hover:text-brand-blue-500 mt-2"
          >
            ← Back to sign in
          </button>
        </CardContent>
      </Card>
    );
  }

  // ── Credentials step ───────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your phone number or email to access your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => submitWith(v))} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Phone or email</Label>
            <Input
              id="identifier"
              placeholder="0712345678 or you@example.com"
              autoComplete="username"
              {...register('identifier')}
            />
            {errors.identifier && <p className="text-xs text-destructive">{errors.identifier.message}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" loading={isSubmitting || submitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand-600 hover:underline font-medium">
            Register your group
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
