"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

interface InstallPromptProps {
  className?: string;
  compact?: boolean;
}

const DISMISS_KEY = "microblog-install-dismissed";

export function InstallPrompt({ className = "", compact = false }: InstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);

    setIsStandalone(standalone);
    setIsIos(ios);
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setDismissed(false);
    };

    const handleInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (isStandalone || dismissed || (!deferredPrompt && !isIos)) {
    return null;
  }

  const handleDismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
    handleDismiss();
  };

  return (
    <div className={`surface-card-soft border border-white/95 ${compact ? "p-4" : "p-5"} ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold tracking-[0.08em] text-[#1f2430]">安装到主屏幕</p>
          <p className="text-sm leading-6 text-soft">
            {deferredPrompt
              ? "安装后可像独立 app 一样从主屏幕直接打开。"
              : "在 Safari 点分享按钮，再选“添加到主屏幕”，即可获得更像 app 的启动体验。"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-full px-2 py-1 text-sm text-soft hover:text-[#1f2430]"
          aria-label="关闭安装提示"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {deferredPrompt ? (
          <button
            type="button"
            onClick={handleInstall}
            className="action-chip"
          >
            立即安装
          </button>
        ) : (
          <div className="rounded-full bg-[#eef7ff] px-4 py-2 text-sm font-medium text-[#4d90cf]">
            Safari → 分享 → 添加到主屏幕
          </div>
        )}
      </div>
    </div>
  );
}
