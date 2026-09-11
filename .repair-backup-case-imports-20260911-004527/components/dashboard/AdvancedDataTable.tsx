"use client";

import { useState } from "react";
import { IconChevronUp, IconChevronDown, IconArrowsUpDown } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";

interface ColumnDef {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (value: any, row: Record<string, any>) => React.ReactNode;
  className?: string;
}

interface AdvancedDataTableProps {
  columns: ColumnDef[];
  data: Record<string, any>[];
  pageSize?: number;
  onRowClick?: (row: Record<string, any>) => void;
  className?: string;
}

type SortOrder = "asc" | "desc" | null;

/**
 * Advanced Data Table component
 * Table with sorting and pagination
 */
export function AdvancedDataTable({
  columns,
  data,
  pageSize = 10,
  onRowClick,
  className = "",
}: AdvancedDataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  // Handle sorting
  const handleSort = (key: string) => {
    if (!columns.find((col) => col.key === key)?.sortable) return;

    if (sortKey === key) {
      // Toggle sort order
      if (sortOrder === "asc") {
        setSortOrder("desc");
      } else if (sortOrder === "desc") {
        setSortOrder(null);
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
    setCurrentPage(1); // Reset to first page
  };

  // Sort data
  const sortedData = [...data].sort((a, b) => {
    if (!sortKey || !sortOrder) return 0;

    const aValue = a[sortKey];
    const bValue = b[sortKey];

    if (aValue < bValue) return sortOrder === "asc" ? -1 : 1;
    if (aValue > bValue) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  // Paginate data
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = sortedData.slice(startIndex, startIndex + pageSize);

  // Get sort icon for column
  const getSortIcon = (key: string) => {
    if (sortKey !== key) {
      return <IconArrowsUpDown size={16} className="text-gray-400" />;
    }
    if (sortOrder === "asc") {
      return <IconChevronUp size={16} className="text-primary-600 dark:text-primary-400" />;
    }
    return <IconChevronDown size={16} className="text-primary-600 dark:text-primary-400" />;
  };

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 dark:text-gray-400">
        No data available
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            {columns.map((column) => (
              <th
                key={column.key}
                onClick={() => column.sortable && handleSort(column.key)}
                className={`px-6 py-3 text-left font-semibold text-gray-900 dark:text-white ${
                  column.sortable ? "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{column.header}</span>
                  {column.sortable && getSortIcon(column.key)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                onRowClick ? "cursor-pointer" : ""
              }`}
            >
              {columns.map((column) => (
                <td
                  key={`${rowIdx}-${column.key}`}
                  className={`px-6 py-4 text-gray-900 dark:text-white ${column.className || ""}`}
                >
                  {column.render ? column.render(row[column.key], row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between px-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Showing {startIndex + 1}-{Math.min(startIndex + pageSize, sortedData.length)} of{" "}
            {sortedData.length} items
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </Button>
            <div className="flex items-center gap-2">
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx + 1)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    currentPage === idx + 1
                      ? "bg-primary-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
