import React from "react";

interface CheckboxFieldProps {
  label: string;
  name: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  helperText?: string;
  disabled?: boolean;
}

/**
 * Checkbox Field component
 * Checkbox with label and helper text
 */
export function CheckboxField({
  label,
  name,
  checked,
  onChange,
  helperText,
  disabled = false,
}: CheckboxFieldProps) {
  return (
    <div className="mb-4">
      <div className="flex items-start">
        <input
          id={name}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="mt-1 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <label
          htmlFor={name}
          className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          {label}
        </label>
      </div>

      {helperText && (
        <p className="mt-2 ml-7 text-sm text-gray-500 dark:text-gray-400">
          {helperText}
        </p>
      )}
    </div>
  );
}
