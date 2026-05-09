'use client';

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
import { useEffect } from 'react';

const schema = z.object({
  groupName:  z.string().min(3, 'Group name must be at least 3 characters'),
  groupType:  z.enum(['chama', 'sacco', 'welfare', 'investment', 'ngo']),
  firstName:  z.string().min(2),
  lastName:   z.string().min(2),
  phone:      z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Valid Kenyan phone required'),
  email:      z.string().email().optional().or(z.literal('')),
  password:   z.string().min(8, 'Password must be at least 8 characters'),
  confirm:    z.string(),
}).refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { groupType: 'chama' },
  });

  useEffect(() => {
    configureApiClient({ getToken: () => null, onUnauthorized: () => {} });
  }, []);

  const onSubmit = async (values: FormValues) => {
    try {
      const { confirm, ...body } = values;
      const data = await authApi.register(body);
      login(data);
      toast({ title: 'Welcome to Kitabu Yetu!', description: `Registration fee: KES ${data.registrationFee?.toLocaleString()}` });
      router.push('/dashboard');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Registration failed', description: err.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your group</CardTitle>
        <CardDescription>Get started with Kitabu Yetu — free for up to 10 members</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 col-span-2">
              <Label>Group name</Label>
              <Input placeholder="Umoja Savings Group" {...register('groupName')} />
              {errors.groupName && <p className="text-xs text-destructive">{errors.groupName.message}</p>}
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Group type</Label>
              <select
                {...register('groupType')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="chama">Chama</option>
                <option value="sacco">SACCO</option>
                <option value="welfare">Welfare Group</option>
                <option value="investment">Investment Club</option>
                <option value="ngo_group">NGO</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>First name</Label>
              <Input placeholder="Jane" {...register('firstName')} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Last name</Label>
              <Input placeholder="Doe" {...register('lastName')} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Phone number</Label>
              <Input placeholder="0712345678" {...register('phone')} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Email (optional)</Label>
              <Input type="email" placeholder="jane@example.com" {...register('email')} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Confirm password</Label>
              <Input type="password" {...register('confirm')} />
              {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
            </div>
          </div>

          <Button type="submit" className="w-full" loading={isSubmitting}>
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
