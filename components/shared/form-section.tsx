import React from 'react';

/**
 * Standardized form field wrapper for Label + Input/Select/Textarea.
 * Provides consistent spacing, styling, and error state handling.
 */
export function FormSection({
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className || 'space-y-1.5'}>
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Wrapper for grouping related form fields together (e.g., first/last name).
 * Provides grid layout for side-by-side fields on larger screens.
 */
export function FormFieldGroup({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  }[columns];

  return (
    <div className={`grid gap-4 ${gridClass} ${className || ''}`}>
      {children}
    </div>
  );
}

/**
 * Visual divider for form sections (e.g., "Personal Info" vs "Contact").
 */
export function FormDivider({ label }: { label?: string }) {
  if (!label) {
    return <div className="border-t my-6" />;
  }

  return (
    <div className="flex items-center gap-3 my-6">
      <div className="flex-1 border-t" />
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex-1 border-t" />
    </div>
  );
}
