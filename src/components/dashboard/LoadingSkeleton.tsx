"use client";

/**
 * Loading Skeleton component
 * Placeholder while content loads
 */

interface LoadingSkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function SkeletonLine({ className = "", width = "w-full", height = "h-4" }: LoadingSkeletonProps) {
  return (
    <div
      className={`${width} ${height} bg-gray-200 dark:bg-gray-700 rounded animate-pulse ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <SkeletonLine height="h-6" width="w-1/3" className="mb-4" />
      <SkeletonLine height="h-4" width="w-2/3" className="mb-2" />
      <SkeletonLine height="h-4" width="w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex gap-4 pb-4 border-b border-gray-200 dark:border-gray-700">
        <SkeletonLine height="h-4" width="w-1/4" />
        <SkeletonLine height="h-4" width="w-1/4" />
        <SkeletonLine height="h-4" width="w-1/4" />
        <SkeletonLine height="h-4" width="w-1/4" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="flex gap-4">
          <SkeletonLine height="h-4" width="w-1/4" />
          <SkeletonLine height="h-4" width="w-1/4" />
          <SkeletonLine height="h-4" width="w-1/4" />
          <SkeletonLine height="h-4" width="w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonCard key={idx} />
      ))}
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SkeletonLine height="h-8" width="w-1/3" />
        <SkeletonLine height="h-4" width="w-1/2" />
      </div>
      <SkeletonGrid count={4} />
      <SkeletonTable rows={5} />
    </div>
  );
}
