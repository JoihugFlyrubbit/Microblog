"use client";

import { useCallback, useEffect, useState } from "react";
import { analyticsApi, AnalyticsSummary } from "@/lib/api";

export function ViewStatsCard() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await analyticsApi.summary();
      if (res.success && res.data) setSummary(res.data);
    } catch (error) {
      console.error("Failed to load page-view summary:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">浏览量</h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-soft">PV</span>
      </div>
      {loading && !summary ? (
        <div className="h-16 animate-pulse rounded-[10px] bg-white/80" />
      ) : summary ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[10px] bg-[#fff3ef] px-2 py-3">
            <p className="text-lg font-semibold text-[#ef8f72]">{summary.todayViews}</p>
            <p className="mt-1 text-[11px] text-soft">今日</p>
          </div>
          <div className="rounded-[10px] bg-[#eef7ff] px-2 py-3">
            <p className="text-lg font-semibold text-[#64b7ea]">{summary.last7DaysViews}</p>
            <p className="mt-1 text-[11px] text-soft">近 7 天</p>
          </div>
          <div className="rounded-[10px] bg-[#eefaf7] px-2 py-3">
            <p className="text-lg font-semibold text-[#68c7b8]">{summary.totalViews}</p>
            <p className="mt-1 text-[11px] text-soft">累计</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-soft">暂时无法读取浏览量</p>
      )}
      <p className="mt-2 text-[11px] leading-5 text-soft">每次加载公开首页计为一次，不记录访客身份。</p>
    </div>
  );
}
