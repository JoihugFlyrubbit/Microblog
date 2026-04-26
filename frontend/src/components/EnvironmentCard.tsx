"use client";

import { useEffect, useState } from "react";

import { getApiBase } from "@/lib/api";
import { formatBeijingTime } from "@/lib/time";

type EnvironmentResponse = {
  success: boolean;
  data?: {
    location: {
      label: string;
    };
    updatedAt: string;
    aqi: {
      value: number | null;
      category: string | null;
      pollutant: string | null;
      status: "ok" | "unavailable";
    };
    uv: {
      value: number | null;
      summary: string | null;
      status: "ok" | "unavailable";
    };
  };
};

export function EnvironmentCard() {
  const [data, setData] = useState<EnvironmentResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${getApiBase()}/environment/live`);
        const result = await response.json() as EnvironmentResponse;
        if (!cancelled && result.success && result.data) {
          setData(result.data);
        }
      } catch (error) {
        console.error("Failed to load environment card:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatedAt = data?.updatedAt
    ? formatBeijingTime(data.updatedAt)
    : "--:--";

  return (
    <div className="surface-card animate-rise-in p-5 transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-center text-[1.15rem] font-semibold text-[#1f2430]">空气与紫外线</h3>
          <p className="mt-1 text-xs text-soft">{data?.location.label || "北京昌平"}</p>
        </div>
        <span className="text-xs text-soft">更新于 {updatedAt}</span>
      </div>

      {loading && !data ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-20 rounded-[5px] bg-white/80" />
          <div className="h-20 rounded-[5px] bg-white/75" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-[5px] border border-white/80 bg-white/78 px-4 py-4">
            <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[#68c7b8]">Air Quality</div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold tracking-[-0.04em] text-[#1f2430]">
                {data?.aqi.value ?? "--"}
              </div>
              <div className="text-right text-sm text-soft">
                <div>{data?.aqi.category || "暂不可用"}</div>
                <div>{data?.aqi.pollutant ? `主要污染物 ${data.aqi.pollutant}` : " "}</div>
              </div>
            </div>
          </div>

          <div className="rounded-[5px] border border-white/80 bg-white/78 px-4 py-4">
            <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[#64b7ea]">UV Index</div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold tracking-[-0.04em] text-[#1f2430]">
                {data?.uv.value ?? "--"}
              </div>
              <div className="max-w-[150px] text-right text-sm leading-6 text-soft">
                {data?.uv.summary || "暂不可用"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
