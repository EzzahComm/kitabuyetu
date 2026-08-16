'use client';

/**
 * Found an additional group under the caller's EXISTING identity — the
 * authenticated counterpart to the public /register form, for a member who
 * already has an account (Kitabu Yetu or Chama Reminder) and hit a dead-end
 * "Phone number already registered" trying to sign up again for the other
 * product. See docs/[plan] iterative-knitting-sutherland.md and migration 147.
 *
 * Group-only fields, no password re-entry: the current session already
 * proves identity, same trust model /auth/switch-group uses.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { api } from '@/lib/api/client';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';
import { postLoginPath } from '@/lib/auth/post-login-path';
import type { CreateAdditionalGroupPayload } from '@/lib/validators/auth.schema';

// Mirrors lib/validators/auth.schema.ts's shared groupDetailsFields — kept in
// sync manually, same convention app/(auth)/register/page.tsx's own schema
// comment already documents for this codebase.
const schema = z.object({
  product:     z.enum(['kitabu_yetu', 'chama_reminder']).default('kitabu_yetu'),
  groupName:   z.string().min(3, 'Group name must be at least 3 characters'),
  // Must match the group_type Postgres enum EXACTLY — see the option value below.
  groupType:   z.enum(['chama', 'sacco', 'welfare', 'investment', 'ngo_group']),
  creatorRole: z.enum(['chairperson', 'secretary', 'treasurer'], {
    errorMap: () => ({ message: 'Select your role in this group' }),
  }),
  countyId:      z.string().uuid('Please pick a county'),
  subCountyText: z.string().max(80).optional().or(z.literal('')),
  wardText:      z.string().max(100).optional().or(z.literal('')),
  villageEstate: z.string().max(200).optional().or(z.literal('')),
  primaryObjective: z.enum([
    'savings', 'table_banking', 'welfare', 'women_empowerment', 'youth_development',
    'agriculture', 'business_investment', 'housing', 'education', 'health',
    'community_development', 'other',
  ]).optional(),
  meetingFrequency: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  meetingDay:       z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']).optional(),
  meetingTime:      z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM').optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface County {
  id:   string;
  name: string;
}

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const PRODUCT_LABELS: Record<FormValues['product'], string> = {
  kitabu_yetu:    'Kitabu Yetu — full accounting, contributions, loans',
  chama_reminder: 'Chama Reminder — SMS reminders only',
};

export default function CreateAdditionalGroupPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { toast } = useToast();
  const [counties, setCounties] = useState<County[]>([]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { groupType: 'chama', creatorRole: 'chairperson', product: 'kitabu_yetu' },
  });

  useEffect(() => {
    api.get<County[]>('/jurisdictions/counties').then(setCounties).catch((err) => {
      toast({ variant: 'destructive', title: 'Could not load counties', description: getErrorMessage(err) });
    });
  }, [toast]);

  const onSubmit = async (values: FormValues) => {
    try {
      const data = await authApi.createGroup(values as CreateAdditionalGroupPayload);
      login(data);
      toast({
        title:       `${values.product === 'chama_reminder' ? 'Chama Reminder' : 'Kitabu Yetu'} group created`,
        description: `${data.groupCode} is ready. Switch between your groups any time from the sidebar.`,
      });
      router.push(postLoginPath(data.member.groupRole, { signupProduct: data.signupProduct }));
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not create group', description: getErrorMessage(err) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create another group"
        description="Found a new group under your existing account — no new phone number or password needed."
        breadcrumbs={[{ label: 'Groups' }, { label: 'New' }]}
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Group details</CardTitle>
          <CardDescription>You&rsquo;ll be switched into the new group once it&rsquo;s created.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <Label>Product</Label>
              <select aria-label="Product" className={selectCls} {...register('product')}>
                {(Object.keys(PRODUCT_LABELS) as FormValues['product'][]).map((p) => (
                  <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="groupName">Group name</Label>
              <Input id="groupName" {...register('groupName')} placeholder="e.g. Umoja Chama" />
              {errors.groupName && <p className="text-xs text-destructive">{errors.groupName.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Group type</Label>
                <select aria-label="Group type" className={selectCls} {...register('groupType')}>
                  <option value="chama">Chama</option>
                  <option value="sacco">SACCO</option>
                  <option value="welfare">Welfare</option>
                  <option value="investment">Investment</option>
                  {/* Real group_type enum value is 'ngo_group', not 'organization_group' —
                      the mismatch made this submission fail with a 500. */}
                  <option value="ngo_group">Organization group</option>
                </select>
              </div>
              <div>
                <Label>Your role in this group</Label>
                <select aria-label="Your role in this group" className={selectCls} {...register('creatorRole')}>
                  <option value="chairperson">Chairperson</option>
                  <option value="secretary">Secretary</option>
                  <option value="treasurer">Treasurer</option>
                </select>
                {errors.creatorRole && <p className="text-xs text-destructive">{errors.creatorRole.message}</p>}
              </div>
            </div>

            <div>
              <Label>County</Label>
              <select aria-label="County" className={selectCls} {...register('countyId')} defaultValue="">
                <option value="" disabled>Select a county</option>
                {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.countyId && <p className="text-xs text-destructive">{errors.countyId.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="subCountyText">Sub-county</Label>
                <Input id="subCountyText" {...register('subCountyText')} placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="wardText">Ward</Label>
                <Input id="wardText" {...register('wardText')} placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="villageEstate">Village / estate</Label>
                <Input id="villageEstate" {...register('villageEstate')} placeholder="Optional" />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" loading={isSubmitting}>Create group</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
