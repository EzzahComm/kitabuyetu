'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const schema = z.object({
  phone: z.string().regex(/^(?:\+254|0)[17]\d{8}$/, 'Enter a valid Kenyan phone number'),
});
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (_values: FormValues) => {
    // Password reset is handled by a group admin or super_admin who can
    // issue a temporary password via the Members admin panel.
    // Self-service OTP reset can be wired here once the SMS OTP endpoint is live.
    setSubmitted(true);
    toast({
      title: 'Request received',
      description: 'Contact your group admin to reset your password.',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>
          Enter your phone number and your group admin will assist with a password reset.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {submitted ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              Please contact your group admin or treasurer. They can set a temporary password
              for you from the Members panel.
            </p>
            <Link href="/login" className="text-sm text-brand-600 hover:underline font-medium">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" placeholder="0712345678" {...register('phone')} />
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={isSubmitting}>
              Request reset
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-brand-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
