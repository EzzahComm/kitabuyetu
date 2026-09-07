/**
 * Export utilities
 * Functions for exporting data to CSV, PDF, etc.
 */

/**
 * Export data to CSV
 * @param data - Array of objects to export
 * @param filename - Name of the exported file
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string = "export.csv"
) {
  if (!data || data.length === 0) {
    console.warn("No data to export");
    return;
  }

  // Get column headers from first row
  const headers = Object.keys(data[0]);

  // Create CSV content
  const csvContent = [
    // Header row
    headers.join(","),
    // Data rows
    ...data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          // Escape quotes and wrap in quotes if contains comma
          if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(",")
    ),
  ].join("\n");

  // Create blob and download
  downloadFile(csvContent, filename, "text/csv;charset=utf-8;");
}

/**
 * Export data to JSON
 * @param data - Data to export
 * @param filename - Name of the exported file
 */
export function exportToJSON<T>(
  data: T,
  filename: string = "export.json"
) {
  const jsonContent = JSON.stringify(data, null, 2);
  downloadFile(jsonContent, filename, "application/json;charset=utf-8;");
}

/**
 * Print table or content
 * @param contentId - ID of element to print
 */
export function printContent(contentId: string) {
  const element = document.getElementById(contentId);
  if (!element) {
    console.warn(`Element with id ${contentId} not found`);
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    console.warn("Could not open print window");
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Print Document</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 20px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
          }
          th {
            background-color: #f5f5f5;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        ${element.innerHTML}
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.print();
}

/**
 * Helper function to download file
 */
function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Export table to CSV
 * @param tableId - ID of table element
 * @param filename - Name of exported file
 */
export function exportTableToCSV(tableId: string, filename: string = "table.csv") {
  const table = document.getElementById(tableId) as HTMLTableElement;
  if (!table) {
    console.warn(`Table with id ${tableId} not found`);
    return;
  }

  const rows: string[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const cells: string[] = [];
    for (let j = 0; j < table.rows[i].cells.length; j++) {
      cells.push(table.rows[i].cells[j].textContent || "");
    }
    rows.push(cells.join(","));
  }

  downloadFile(rows.join("\n"), filename, "text/csv;charset=utf-8;");
}

/**
 * Usage examples:
 *
 * // Export array of objects to CSV
 * const members = [
 *   { name: "John", email: "john@example.com", savings: 25000 },
 *   { name: "Jane", email: "jane@example.com", savings: 18500 },
 * ];
 * exportToCSV(members, "members.csv");
 *
 * // Export to JSON
 * exportToJSON(members, "members.json");
 *
 * // Print content
 * printContent("table-id");
 *
 * // Export HTML table
 * exportTableToCSV("members-table", "members.csv");
 */
