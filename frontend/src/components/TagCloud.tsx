"use client";

import { useState, useEffect, useCallback } from "react";
import { tagsApi, TagWithCount } from "@/lib/api";

const tagPalette = [
  { idle: "text-[#ef8f72] bg-[#fff3ef]", active: "bg-[#ef8f72] text-white" },
  { idle: "text-[#64b7ea] bg-[#eef7ff]", active: "bg-[#64b7ea] text-white" },
  { idle: "text-[#68c7b8] bg-[#eefaf7]", active: "bg-[#68c7b8] text-white" },
  { idle: "text-[#f1b94e] bg-[#fff9ea]", active: "bg-[#f1b94e] text-white" },
  { idle: "text-[#8b78e6] bg-[#f5f2ff]", active: "bg-[#8b78e6] text-white" },
];

interface TagCloudProps {
  onTagSelect?: (tag?: string) => void;
  selectedTag?: string;
  includePrivate?: boolean;
  refreshKey?: number;
}

export function TagCloud({ onTagSelect, selectedTag, includePrivate = false, refreshKey = 0 }: TagCloudProps) {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tagsApi.list({ includePrivate });
      if (res.success && res.data) {
        setTags(res.data.tags);
      }
    } catch (error) {
      console.error("Failed to load tags:", error);
    } finally {
      setLoading(false);
    }
  }, [includePrivate]);

  useEffect(() => {
    loadTags();
  }, [loadTags, refreshKey]);

  if (loading) {
    return (
      <div>
        <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-9 w-20 animate-pulse rounded-full bg-white/80"
            />
          ))}
        </div>
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div>
        <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
        <p className="text-sm text-soft">暂无标签</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <button
            key={tag.id}
            onClick={() => onTagSelect?.(selectedTag === tag.name ? undefined : tag.name)}
            className={`
              inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors
              ${
                selectedTag === tag.name
                  ? `${tagPalette[index % tagPalette.length].active} shadow-[0_14px_28px_rgba(93,101,118,0.18)]`
                  : tagPalette[index % tagPalette.length].idle
              }
            `}
          >
            #{tag.name}
            <span className="text-[10px] opacity-70">({tag.post_count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
