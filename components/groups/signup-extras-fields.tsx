'use client';

/**
 * The two group sign-up sections shared by /register and /groups/new: what each
 * member owes every month, and whether the group is registered. One copy, so the
 * two forms cannot drift apart on wording, validation or the PDF handling.
 */
import { useState, type ChangeEvent } from 'react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CERTIFICATE_LIMIT_MB, MAX_CERTIFICATE_BYTES } from '@/lib/utils/certificate-limits';

/** The sign-up fields these sections own: a subset of every group sign-up form's values. */
export interface SignupExtrasFields {
  monthlyContribution?: number;
  welfareAmount?: number;
  isGovernmentRegistered: boolean;
  registrationNumber?: string;
}

/**
 * Holds the registration certificate the registrant picked. The file is kept
 * outside react-hook-form because it is sent as a multipart part, not as JSON.
 * A file that is not a PDF, or is too big, is rejected here with a reason
 * instead of being sent only for the server to drop it.
 */
export function useCertificateFile() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by reset() and used as the input's `key`, which is the only way to
  // clear a file input's displayed filename.
  const [inputKey, setInputKey] = useState(0);

  const onSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      setError(null);
    } else if (picked.type !== 'application/pdf') {
      setFile(null);
      setError('The certificate must be a PDF.');
    } else if (picked.size > MAX_CERTIFICATE_BYTES) {
      setFile(null);
      setError(`That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB; the limit is ${CERTIFICATE_LIMIT_MB} MB.`);
    } else {
      setFile(picked);
      setError(null);
    }
  };

  const reset = () => {
    setFile(null);
    setError(null);
    setInputKey((k) => k + 1);
  };

  return { file, error, onSelect, reset, inputKey };
}

export type CertificateFile = ReturnType<typeof useCertificateFile>;

interface SectionProps<T extends SignupExtrasFields> {
  /** The host form's own register: it knows many more fields than these sections use. */
  register: UseFormRegister<T>;
  /** Heading class: each page owns its own section-title styling. */
  titleClassName: string;
}

/**
 * react-hook-form's UseFormRegister<T> is not assignable to UseFormRegister<Subset>,
 * so the sections take the host form's register generically and narrow it here.
 * Safe because T extends SignupExtrasFields: every name these sections register
 * exists on the host form.
 */
function narrowRegister<T extends SignupExtrasFields>(
  register: UseFormRegister<T>,
): UseFormRegister<SignupExtrasFields> {
  return register as unknown as UseFormRegister<SignupExtrasFields>;
}

/** Only rendered for Kitabu Yetu; Chama Reminder has no ledger to track contributions against. */
export function GroupFinanceFields<T extends SignupExtrasFields>({
  register: hostRegister,
  errors,
  titleClassName,
}: SectionProps<T> & { errors: FieldErrors<SignupExtrasFields> }) {
  const register = narrowRegister(hostRegister);
  return (
    <>
      <p className={titleClassName}>Group finances</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="monthlyContribution">Monthly contribution (KES)</Label>
          <Input
            id="monthlyContribution"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 500"
            required
            {...register('monthlyContribution')}
          />
          {errors.monthlyContribution && (
            <p className="text-xs text-destructive">{errors.monthlyContribution.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="welfareAmount">Welfare amount (KES)</Label>
          <Input
            id="welfareAmount"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 200"
            required
            {...register('welfareAmount')}
          />
          {errors.welfareAmount && <p className="text-xs text-destructive">{errors.welfareAmount.message}</p>}
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          What each member owes your group every month. Members who fall behind get a monthly SMS showing their balance
          and where to pay — you can change these anytime in Settings.
        </p>
      </div>
    </>
  );
}

/**
 * Entirely optional and never blocks sign-up or subscribing. Either the number
 * or the certificate is enough to mark the group registered; both, one or
 * neither is fine, and it can all be added later from Settings.
 */
export function GroupRegistrationFields<T extends SignupExtrasFields>({
  register: hostRegister,
  titleClassName,
  registered,
  certificate,
}: SectionProps<T> & { registered: boolean; certificate: CertificateFile }) {
  const register = narrowRegister(hostRegister);
  return (
    <>
      <p className={titleClassName}>
        Registration <span className="lowercase font-normal text-muted-foreground normal-case">(optional)</span>
      </p>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" {...register('isGovernmentRegistered')} />
          Is your group registered (e.g. with the Social Services / Cooperatives / NGO Board)?
        </label>
        {/* Kept mounted and hidden rather than unmounted: the picked file lives in
            state, and an unmounted file input would silently forget it while the
            state still held it. */}
        <div className={registered ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'hidden'}>
          <div className="space-y-1.5">
            <Label htmlFor="registrationNumber">Registration number</Label>
            <Input id="registrationNumber" placeholder="e.g. CBO/12345/2024" {...register('registrationNumber')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="registrationCertificate">
              Or upload certificate (PDF, up to {CERTIFICATE_LIMIT_MB} MB)
            </Label>
            <Input
              key={certificate.inputKey}
              id="registrationCertificate"
              type="file"
              accept="application/pdf"
              onChange={certificate.onSelect}
            />
            {certificate.error && <p className="text-xs text-destructive">{certificate.error}</p>}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Add the number, the certificate, or both — whichever you have to hand now. You can add or change this later
            from Settings.
          </p>
        </div>
      </div>
    </>
  );
}
