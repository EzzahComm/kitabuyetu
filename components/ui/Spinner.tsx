"use client";

import React from "react";

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "success" | "warning" | "error" | "slate";
}

/**
 * Spinner component for loading states
 * Supports multiple sizes and color variants
 */
const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ size = "md", variant = "primary", className, ...props }, ref) => {
    const sizes = {
      sm: "w-4 h-4",
      md: "w-6 h-6",
      lg: "w-8 h-8",
    };

    const variants = {
      primary: "text-primary-500",
      success: "text-success-500",
      warning: "text-warning-500",
      error: "text-error-500",
      slate: "text-slate-500",
    };

    return (
      <div ref={ref} className={`inline-block ${className || ""}`} {...props}>
        <svg
          className={`${sizes[size]} ${variants[variant]} animate-spin`}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          role="status"
          aria-label="Loading"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }
);

Spinner.displayName = "Spinner";

export { Spinner };
export default Spinner;
