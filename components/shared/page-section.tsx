import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Standardized page section wrapper combining Card + consistent spacing.
 * Use for grouping related content areas across a page.
 */
export function PageSection({
  title,
  description,
  children,
  action,
  className,
  noPadding,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  const isCardLayout = title || description || action;

  if (!isCardLayout) {
    return (
      <div className={`space-y-3 ${className || ''}`}>
        {children}
      </div>
    );
  }

  return (
    <Card className={className}>
      {(title || description || action) && (
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {title && <CardTitle>{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {action}
          </div>
        </CardHeader>
      )}
      {!noPadding && <CardContent>{children}</CardContent>}
      {noPadding && children}
    </Card>
  );
}

/**
 * Wrapper for action button groups at the bottom of forms/dialogs.
 * Provides consistent spacing and alignment.
 */
export function FormActions({
  children,
  align = 'right',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center' | 'between';
  className?: string;
}) {
  const alignClass = {
    left: 'justify-start',
    right: 'justify-end',
    center: 'justify-center',
    between: 'justify-between',
  }[align];

  return (
    <div className={`flex gap-3 ${alignClass} pt-6 border-t ${className || ''}`}>
      {children}
    </div>
  );
}
