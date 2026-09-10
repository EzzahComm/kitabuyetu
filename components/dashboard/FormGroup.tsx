import React from "react";

interface FormGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Form Group component
 * Groups related form fields with optional title and description
 */
export function FormGroup({
  title,
  description,
  children,
}: FormGroupProps) {
  return (
    <div className="mb-8">
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </div>
  );
}
