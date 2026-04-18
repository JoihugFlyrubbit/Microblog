"use client";

import { useState } from "react";
import { getApiBase } from "@/lib/api";

export function ExportButton() {
  const [showOptions, setShowOptions] = useState(false);
  const [format, setFormat] = useState<"json" | "csv" | "html" | "markdown">("json");
  const [includePrivate, setIncludePrivate] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      // Use direct fetch for CSV support (apiClient always parses JSON)
      const response = await fetch(`${getApiBase()}/export`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format,
          includePrivate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "导出失败");
      }

      if (format === "csv") {
        // Handle CSV response
        const csvText = await response.text();
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `microblog-export-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (format === "markdown") {
        const markdownText = await response.text();
        const blob = new Blob([markdownText], { type: "text/markdown;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `microblog-export-${new Date().toISOString().split("T")[0]}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (format === "html") {
        const htmlText = await response.text();
        const blob = new Blob([htmlText], { type: "text/html;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `microblog-export-${new Date().toISOString().split("T")[0]}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Handle JSON response
        const data = await response.json();
        if (data.success) {
          const blob = new Blob([JSON.stringify(data.data, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `microblog-export-${new Date().toISOString().split("T")[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          throw new Error(data.error?.message || "导出失败");
        }
      }

      setShowOptions(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误，请重试");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430] transition-colors hover:text-[#64b7ea]">数据导出</h3>

      {error && (
        <div className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {!showOptions ? (
        <button
          onClick={() => setShowOptions(true)}
          className="w-full rounded-full border border-[#d9dce4] bg-white px-4 py-3 text-sm font-semibold text-[#1f2430] hover:text-[#64b7ea]"
        >
          导出数据
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              格式
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  value="json"
                  checked={format === "json"}
                  onChange={(e) => setFormat(e.target.value as "json")}
                  className="w-4 h-4"
                />
                <span className="text-sm">JSON</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  value="csv"
                  checked={format === "csv"}
                  onChange={(e) => setFormat(e.target.value as "csv")}
                  className="w-4 h-4"
                />
                <span className="text-sm">CSV</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  value="html"
                  checked={format === "html"}
                  onChange={(e) => setFormat(e.target.value as "html")}
                  className="w-4 h-4"
                />
                <span className="text-sm">HTML</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  value="markdown"
                  checked={format === "markdown"}
                  onChange={(e) => setFormat(e.target.value as "markdown")}
                  className="w-4 h-4"
                />
                <span className="text-sm">Markdown</span>
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(e) => setIncludePrivate(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">包含全部内容</span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={() => setShowOptions(false)}
              className="flex-1 rounded-full px-4 py-2 text-sm font-medium text-soft hover:text-[#1f2430]"
            >
              取消
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex-1 rounded-full bg-[#64b7ea] px-4 py-2 text-sm font-semibold text-white hover:bg-[#53a7da] disabled:opacity-50"
            >
              {exporting ? "导出中..." : "确认导出"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
