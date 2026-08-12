"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { tagsApi, TagCategory, TagWithCount } from "@/lib/api";
import { groupTags } from "@/lib/tags";

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
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [collapsedLimit, setCollapsedLimit] = useState(8);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tagsApi.list({ includePrivate });
      if (res.success && res.data) {
        setTags(res.data.tags);
        setCategories(res.data.categories);
        setCollapsedLimit(res.data.collapsedLimit);
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

  const groups = useMemo(
    () => groupTags(tags, categories, collapsedLimit),
    [tags, categories, collapsedLimit]
  );

  useEffect(() => {
    if (!selectedTag) return;
    const selectedGroup = groups.find((group) => (
      group.tags.some((tag) => tag.name === selectedTag)
      && group.tags.findIndex((tag) => tag.name === selectedTag) >= group.collapsedLimit
    ));
    if (selectedGroup) {
      setExpandedGroups((current) => new Set(current).add(selectedGroup.key));
    }
  }, [groups, selectedTag]);

  if (loading) {
    return (
      <div>
        <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 w-20 animate-pulse rounded-full bg-white/80" />)}
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

  if (!includePrivate) {
    return (
      <div>
        <h3 className="mb-3 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, index) => {
            const palette = tagPalette[index % tagPalette.length];
            return (
              <button
                key={tag.id}
                onClick={() => onTagSelect?.(selectedTag === tag.name ? undefined : tag.name)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors ${
                  selectedTag === tag.name
                    ? `${palette.active} shadow-[0_14px_28px_rgba(93,101,118,0.18)]`
                    : palette.idle
                }`}
              >
                #{tag.name}
                <span className="text-[10px] opacity-70">({tag.post_count})</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">标签</h3>
      <div className="space-y-4">
        {groups.map((group) => {
          const expanded = expandedGroups.has(group.key);
          const visibleTags = expanded ? group.tags : group.tags.slice(0, group.collapsedLimit);
          const hiddenCount = group.tags.length - visibleTags.length;
          return (
            <section key={group.key}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold tracking-[0.12em] text-soft">{group.name}</h4>
                <span className="text-[10px] text-soft">{group.tags.length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleTags.map((tag) => {
                  const palette = tagPalette[tag.id % tagPalette.length];
                  return (
                    <button
                      key={tag.id}
                      onClick={() => onTagSelect?.(selectedTag === tag.name ? undefined : tag.name)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors ${
                        selectedTag === tag.name
                          ? `${palette.active} shadow-[0_14px_28px_rgba(93,101,118,0.18)]`
                          : palette.idle
                      }`}
                    >
                      #{tag.name}
                      <span className="text-[10px] opacity-70">({tag.post_count})</span>
                    </button>
                  );
                })}
              </div>
              {group.tags.length > group.collapsedLimit && (
                <button
                  type="button"
                  onClick={() => setExpandedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })}
                  className="mt-2 text-xs font-semibold text-[#5d8fd6] hover:underline"
                >
                  {expanded ? "收起" : `展开其余 ${hiddenCount} 个`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
