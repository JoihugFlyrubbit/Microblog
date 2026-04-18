"use client";

import { useEffect } from "react";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({
  error,
  reset,
}: GlobalErrorPageProps) {
  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">应用发生错误</h2>
            <p className="mt-2 text-sm text-gray-600">
              Next.js 在渲染根布局时遇到了问题。可以先重试一次。
            </p>
            <button
              onClick={reset}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              重新加载
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
