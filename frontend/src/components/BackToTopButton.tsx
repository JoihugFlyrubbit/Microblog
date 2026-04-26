"use client";

import { useEffect, useState } from "react";

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 420);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={[
        "fixed z-40 flex h-12 w-12 items-center justify-center rounded-full",
        "border border-white/80 bg-white/90 text-lg text-[#1f2430] shadow-[0_18px_36px_rgba(68,73,88,0.18)] backdrop-blur",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      ].join(" ")}
      style={{
        right: "max(1rem, calc((100vw - 72rem) / 2 - 4rem))",
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      ↑
    </button>
  );
}
