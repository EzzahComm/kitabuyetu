"use client";

import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
}

/**
 * Input component with label, error handling, and helper text
 * Follows accessibility best practices (proper labels, error messaging)
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, icon, className, id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-slate-900 dark:text-slate-50 mb-2"
          >
            {label}
            {props.required && <span className="text-error-600 ml-1">*</span>}
          </label>
        )}

        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500 pointer-events-none">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`
              w-full px-4 py-2 text-base border-2 rounded-md
              transition-colors duration-150
              focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20
              disabled:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50
              dark:bg-slate-800 dark:text-slate-50 dark:border-slate-600
              dark:disabled:bg-slate-700
              ${icon ? "pl-10" : ""}
              ${
                error
                  ? "border-error-500 focus:border-error-500 focus:ring-error-500/20"
                  : "border-slate-300 dark:border-slate-600"
              }
              ${className || ""}
            `}
            {...props}
          />
        </div>

        {error && (
          <p className="mt-2 text-sm font-medium text-error-600 dark:text-error-400">
            {error}
          </p>
        )}

        {helperText && !error && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };
export default Input;
