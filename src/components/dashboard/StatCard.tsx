import React from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Stat Card component
 * Simple card for displaying statistics
 */
export function StatCard({
  title,
  value,
  description,
  icon,
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`p-6 bg-white dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg ${className}`}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {title}
        </h3>
        {icon && <div className="flex-shrink-0">{icon}</div>}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-white">
          {value}
        </span>
      </div>

      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {description}
        </p>
      )}
    </div>
  );
}
