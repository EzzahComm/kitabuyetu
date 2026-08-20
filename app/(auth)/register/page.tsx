'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useEffect, useState, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { configureApiClient, api, ApiError } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { formatMembershipNo } from '@/lib/utils/membership-no';
import { getErrorMessage } from '@/lib/utils';
import { postLoginPath } from '@/lib/auth/post-login-path';
import { GROUP_TYPES, GROUP_TYPE_LABELS } from '@/types/enums';
import type { SubscriptionProduct } from '@/types/enums';

// Mirrors lib/validators/auth.schema.ts (RegisterSchema). Kept in sync
// manually for now — single shared types lib is a Phase F cleanup.
const schema = z.object({
  // Identity
  groupName: z.string().min(3, 'Group name must be at least 3 characters'),
  // Must match the group_type Postgres enum EXACTLY — derived from the shared
  // GROUP_TYPES tuple so this client copy cannot drift from the server schema.
  groupType: z.enum(GROUP_TYPES),

  // Registrant
  firstName: z.string().min(2, 'Required'),
  lastName:  z.string().min(2, 'Required'),
  phone:     z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Valid Kenyan phone required'),
  email:     z.string().email('Invalid email').optional().or(z.literal('')),
  password:  z.string().min(8, 'At least 8 characters')
                .regex(/[A-Z]/, 'Needs an uppercase letter')
                .regex(/[0-9]/, 'Needs a number'),
  confirm:   z.string(),

  // Governance — registrant must hold one of the three mandatory roles.
  creatorRole: z.enum(['chairperson', 'secretary', 'treasurer'], {
    errorMap: () => ({ message: 'Select your role' }),
  }),

  // Location
  countyId:      z.string().uuid('Please pick a county'),
  subCountyText: z.string().max(80).optional().or(z.literal('')),
  wardText:      z.string().max(100).optional().or(z.literal('')),
  villageEstate: z.string().max(200).optional().or(z.literal('')),

  // Purpose + cadence (optional in Phase D MVP; required later by activation gate)
  primaryObjective: z.enum([
    'savings','table_banking','welfare','women_empowerment','youth_development',
    'agriculture','business_investment','housing','education','health',
    'community_development','other',
  ]).optional(),
  meetingFrequency: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  meetingDay:       z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']).optional(),
  meetingTime:      z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM').optional().or(z.literal('')),
}).refine((d) => d.password === d.confirm, {
  message: 'Passwords do not match',
  path:    ['confirm'],
});

type FormValues = z.infer<typeof schema>;

interface County {
  id:     string;
  code:   string;
  name:   string;
  region: string | null;
}

const OBJECTIVES: { value: NonNullable<FormValues['primaryObjective']>; label: string }[] = [
  { value: 'savings',              label: 'Savings' },
  { value: 'table_banking',        label: 'Table banking' },
  { value: 'welfare',              label: 'Welfare' },
  { value: 'women_empowerment',    label: 'Women empowerment' },
  { value: 'youth_development',    label: 'Youth development' },
  { value: 'agriculture',          label: 'Agriculture' },
  { value: 'business_investment',  label: 'Business / investment' },
  { value: 'housing',              label: 'Housing' },
  { value: 'education',            label: 'Education' },
  { value: 'health',               label: 'Health' },
  { value: 'community_development', label: 'Community development' },
  { value: 'other',                label: 'Other' },
];

const DAYS: { value: NonNullable<FormValues['meetingDay']>; label: string }[] = [
  { value: 'monday',    label: 'Monday' },
  { value: 'tuesday',   label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday',  label: 'Thursday' },
  { value: 'friday',    label: 'Friday' },
  { value: 'saturday',  label: 'Saturday' },
  { value: 'sunday',    label: 'Sunday' },
];

const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const sectionTitle = 'text-xs font-semibold uppercase tracking-wider text-brand-blue-500 pt-2';

/**
 * One form for both products, not two.
 *
 * register_group() validates the same fields regardless of product — the only
 * Kitabu-Yetu-flavoured field is countyId, and that is a client-side nicety
 * rather than an RPC requirement. A second, divergent signup form would be a
 * permanent sync liability for one saved field, so the product changes the copy
 * and the destination, nothing else.
 */
const PRODUCT_COPY = {
  kitabu_yetu: {
    title:    'Create your group',
    subtitle: 'Build Vibrant Communities',
    cta:      'Create group',
  },
  chama_reminder: {
    title:    'Start with Chama Reminder',
    subtitle: 'Remind. Inform. Celebrate. Mobilize.',
    cta:      'Create group',
  },
} as const;

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const { toast } = useToast();
  const [counties, setCounties] = useState<County[]>([]);

  // /register?product=chama_reminder is the standalone acquisition entry point.
  // Anything else — including a tampered value — falls back to kitabu_yetu, and
  // the server's own enum does the same.
  const product: SubscriptionProduct =
    searchParams.get('product') === 'chama_reminder' ? 'chama_reminder' : 'kitabu_yetu';
  const copy = PRODUCT_COPY[product];

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { groupType: 'chama', creatorRole: 'chairperson' },
  });

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
    // Fetch counties for the dropdown; CDN-cached on the server side so this
    // is essentially a no-op after the first request in a region.
    api.get<County[]>('/jurisdictions/counties')
      .then(setCounties)
      .catch((err) => {
        // Non-fatal — the form still renders, the user just can't pick a county.
        // Surface a small banner so they know to retry.
        toast({
          variant: 'destructive',
          title: 'Could not load counties',
          description: err?.message ?? 'Please refresh the page.',
        });
      });
  }, [toast]);

  const onSubmit = async (values: FormValues) => {
    try {
      const { confirm: _unused, ...body } = values;
      const data = await authApi.register({ ...body, product }) as Awaited<ReturnType<typeof authApi.register>> & {
        groupCode?:     string;
        membershipNo?:  string;
        signupProduct?: SubscriptionProduct;
      };
      login(data);
      // The Membership Number is the member's payment account number — the
      // only payment identifier we ever show (payment architecture §1.1).
      toast({
        title:       product === 'chama_reminder' ? 'Welcome to Chama Reminder!' : 'Welcome to Kitabu Yetu!',
        description: `Your group is ${data.groupCode ?? 'created'}.`
          + (data.membershipNo ? ` Your account number: ${formatMembershipNo(data.membershipNo)}.` : ''),
      });
      // Verification comes first either way; postLoginPath decides the portal
      // once the group is active. The new group holds no subscription yet
      // (migration 139), so signupProduct is the only thing that can route it.
      router.push(
        data.member.groupStatus === 'pending_verification'
          ? '/verify-group'
          : postLoginPath(data.member.groupRole, { signupProduct: product }),
      );
    } catch (err) {
      // A duplicate phone means this person already has an account somewhere
      // on the platform — register_group() always creates a brand-new one, so
      // it can never be the fix here. Point them at logging in instead of a
      // dead-end error; "Create another group" (from their dashboard once
      // logged in) is the real path to founding this second group.
      if (err instanceof ApiError && err.code === 'DUPLICATE_PHONE') {
        const productLabel = product === 'chama_reminder' ? 'Chama Reminder' : 'Kitabu Yetu';
        // This copy used to jump straight to "Create another group", which is
        // the wrong advice for the commonest way people reach this error: the
        // FIRST attempt actually succeeded server-side and only the response
        // was lost (a dropped connection on a slow mobile network shows up as
        // "Failed to fetch"). register_group() had already committed the group,
        // so the retry hits the members.phone UNIQUE constraint. Telling that
        // person to create another group would give them a second, duplicate
        // group. Lead with logging in — which recovers the group they already
        // made, verification screen and all — and mention the second-group path
        // only as the follow-on.
        toast({
          variant: 'destructive',
          title:   'This phone number already has an account',
          description: (
            <>
              If your last attempt showed an error, your group may already have been
              created — <Link href="/login" className="underline">log in</Link> to check
              and finish verifying it. Already have a different group? Log in and use
              &ldquo;Create another group&rdquo; to add {productLabel}.
            </>
          ),
        });
        return;
      }
      const code = err instanceof ApiError ? ` (${err.code})` : '';
      toast({
        variant:     'destructive',
        title:       'Registration failed',
        description: `${getErrorMessage(err)}${code}`,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>
          {/* "Free for up to 10 members" used to sit here. Migration 139
              retired the free tier — every plan is paid — so that line was
              promising something the product no longer does. */}
          {copy.subtitle}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          {/* ─── Group identity ─── */}
          <p className={sectionTitle}>Group</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Group name</Label>
              <Input placeholder="Umoja Savings Group" {...register('groupName')} />
              {errors.groupName && <p className="text-xs text-destructive">{errors.groupName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Group type</Label>
              {/* Rendered from GROUP_TYPE_LABELS, not hand-written <option>s.
                  The values were corrected to real enum members once already
                  (PR #95, after "organization_group" 500'd every signup) but
                  the labels were left behind in two separate copies of this
                  list — so "Organization" stayed on screen long after the bug
                  behind it was fixed. One map now feeds both dropdowns. */}
              <select {...register('groupType')} className={selectCls}>
                {GROUP_TYPES.map((t) => (
                  <option key={t} value={t}>{GROUP_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Primary objective</Label>
              <select {...register('primaryObjective')} className={selectCls} defaultValue="">
                <option value="">— Optional —</option>
                {OBJECTIVES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ─── Location ─── */}
          <p className={sectionTitle}>Location</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>County</Label>
              <select {...register('countyId')} className={selectCls} defaultValue="">
                <option value="" disabled>
                  {counties.length === 0 ? 'Loading counties…' : 'Select a county'}
                </option>
                {counties.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.region ? ` — ${c.region}` : ''}</option>
                ))}
              </select>
              {errors.countyId && <p className="text-xs text-destructive">{errors.countyId.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Sub-county <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="e.g. Bungoma West" {...register('subCountyText')} />
            </div>
            <div className="space-y-1.5">
              <Label>Ward <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="e.g. Township" {...register('wardText')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Village / estate <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="e.g. Sang'alo Plot 24" {...register('villageEstate')} />
            </div>
          </div>

          {/* ─── Meeting schedule ─── */}
          <p className={sectionTitle}>Meeting schedule <span className="lowercase font-normal text-muted-foreground normal-case">(optional)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <select {...register('meetingFrequency')} className={selectCls} defaultValue="">
                <option value="">—</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Day</Label>
              <select {...register('meetingDay')} className={selectCls} defaultValue="">
                <option value="">—</option>
                {DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" {...register('meetingTime')} />
              {errors.meetingTime && <p className="text-xs text-destructive">{errors.meetingTime.message}</p>}
            </div>
          </div>

          {/* ─── About you ─── */}
          <p className={sectionTitle}>About you</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input placeholder="Jane" {...register('firstName')} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input placeholder="Doe" {...register('lastName')} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Phone number</Label>
              <Input placeholder="0712345678" {...register('phone')} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="email" placeholder="jane@example.com" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Your role in the group</Label>
              <select {...register('creatorRole')} className={selectCls}>
                <option value="chairperson">Chairperson</option>
                <option value="secretary">Secretary</option>
                <option value="treasurer">Treasurer</option>
              </select>
              {errors.creatorRole && <p className="text-xs text-destructive">{errors.creatorRole.message}</p>}
              <p className="text-xs text-muted-foreground">
                The person creating the group must hold one of the three mandatory officer positions.
              </p>
            </div>
          </div>

          {/* ─── Credentials ─── */}
          <p className={sectionTitle}>Credentials</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Confirm password</Label>
              <Input type="password" {...register('confirm')} />
              {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
            </div>
          </div>

          <Button type="submit" className="w-full mt-2" loading={isSubmitting}>
            Create group
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-600 hover:underline font-medium">Sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * useSearchParams() forces client-side rendering for whatever subtree reads it,
 * so Next requires a Suspense boundary above it or the static prerender of
 * /register fails the build outright. The form is the only thing that needs the
 * ?product= value, so the boundary sits directly around it.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={
      <Card>
        <CardHeader>
          <CardTitle>Create your group</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    }>
      <RegisterForm />
    </Suspense>
  );
}
