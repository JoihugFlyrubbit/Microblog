"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "@/lib/api";

type EnvironmentResponse = {
  success: boolean;
  data?: {
    aqi: {
      value: number | null;
    };
    uv: {
      value: number | null;
    };
  };
};

export function EnvironmentHeaderBadge() {
  const [aqi, setAqi] = useState<number | null>(null);
  const [uv, setUv] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${getApiBase()}/environment/live`);
        const result = await response.json() as EnvironmentResponse;
        if (!cancelled && result.success && result.data) {
          setAqi(result.data.aqi.value);
          setUv(result.data.uv.value);
        }
      } catch (error) {
        console.error("Failed to load environment badge:", error);
      }
    };

    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    const handleFocus = () => {
      void load();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return (
    <div className="pointer-events-none justify-self-center">
      <div className="flex h-10 items-center justify-center sm:hidden">
        <div className="rounded-full bg-[#49aff3] px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(73,175,243,0.22)]">
          AQI {aqi ?? "--"} / UV {uv ?? "--"}
        </div>
      </div>
      <div className="relative hidden h-10 min-w-[144px] items-center justify-center px-6 sm:flex">
        <span className="absolute inset-x-4 bottom-0 top-4 rounded-[999px] bg-[#49aff3]" />
        <span className="absolute left-2 top-[0.85rem] h-6 w-6 rounded-full bg-[#49aff3]" />
        <span className="absolute left-8 top-0 h-8 w-8 rounded-full bg-[#49aff3]" />
        <span className="absolute left-[3.55rem] top-[0.45rem] h-6 w-6 rounded-full bg-[#49aff3]" />
        <span className="absolute right-[3.65rem] top-[0.35rem] h-7 w-7 rounded-full bg-[#49aff3]" />
        <span className="absolute right-6 top-[0.9rem] h-5 w-5 rounded-full bg-[#49aff3]" />
        <span className="absolute right-2 top-[1.15rem] h-4 w-4 rounded-full bg-[#49aff3]" />
        <span className="relative z-10 mt-2 text-[11px] font-semibold tracking-[0.02em] text-white">
          AQI {aqi ?? "--"} / UV {uv ?? "--"}
        </span>
      </div>
    </div>
  );
}
