import React from "react";

interface ColumnDef {
  key: string;
  header: string;
  render?: (value: any, row: Record<string, any>) => React.ReactNode;
  className?: string;
}

interface DataTableProps {
  columns: ColumnDef[];
  data: Record<string, any>[];
  onRowClick?: (row: Record<string, any>) => void;
  emptyMessage?: string;
  className?: string;
}

/**
 * Data Table component
 * Basic table for displaying structured data
 */
export function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = "No records to show yet.",
  className = "",
}: DataTableProps) {
  if (data.length === 0) {
    return (
      <div className="border-y border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-700">
        <p className="font-semibold text-slate-800 dark:text-slate-100">{emptyMessage}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Try changing the filters or add the first record.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full text-sm border-collapse ${className}`}
      >
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            {columns.map((column) => (
              <th
                key={column.key}
                className="px-6 py-3 text-left font-semibold text-gray-900 dark:text-white"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr
              key={row.id ?? row.key ?? rowIdx}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                onRowClick ? "cursor-pointer" : ""
              }`}
            >
              {columns.map((column) => (
                <td
                  key={`${row.id ?? row.key ?? rowIdx}-${column.key}`}
                  className={`px-6 py-4 text-gray-900 dark:text-white ${
                    column.className || ""
                  }`}
                >
                  {column.render
                    ? column.render(row[column.key], row)
                    : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
