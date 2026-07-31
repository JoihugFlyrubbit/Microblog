"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, TagCategory, TagCollectionData, TagWithCount, tagsApi } from "@/lib/api";

interface TagManagerModalProps {
  onClose: () => void;
  onChanged?: () => void;
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "操作失败，请稍后重试";
}

function groupKey(categoryId: number | null) {
  return categoryId == null ? "uncategorized" : `category-${categoryId}`;
}

export function TagManagerModal({ onClose, onChanged }: TagManagerModalProps) {
  const [data, setData] = useState<TagCollectionData | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedTagIdsByGroup, setSelectedTagIdsByGroup] = useState<Record<string, Set<number>>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState("");
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await tagsApi.manage();
    if (res.success && res.data) {
      setData(res.data);
      setLimitDrafts({
        ...Object.fromEntries(res.data.categories.map((category) => [groupKey(category.id), String(category.collapsed_limit ?? 8)])),
        uncategorized: String(res.data.collapsedLimit),
      });
      setSelectedTagIdsByGroup((current) => Object.fromEntries(
        Object.entries(current).map(([key, ids]) => [
          key,
          new Set(Array.from(ids).filter((id) => res.data?.tags.some((tag) => tag.id === id))),
        ])
      ));
    }
  }, []);

  useEffect(() => {
    load().catch((loadError) => setError(errorMessage(loadError)));
  }, [load]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
      onChanged?.();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setBusy(false);
    }
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    await run(() => tagsApi.createCategory({ name, collapsedLimit: 8 }));
    setNewCategoryName("");
  };

  const renameCategory = (category: TagCategory) => {
    const name = window.prompt("新的分类名称", category.name)?.trim();
    if (!name || name === category.name) return;
    run(() => tagsApi.updateCategory(category.id, { name }));
  };

  const deleteCategory = (category: TagCategory) => {
    if (!data) return;
    const tagCount = data.tags.filter((tag) => tag.category_id === category.id).length;
    if (!window.confirm(`删除分类“${category.name}”？其中 ${tagCount} 个标签会移到“未分类”，动态不会删除。`)) return;
    setExpandedKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey(category.id));
      return next;
    });
    run(() => tagsApi.deleteCategory(category.id));
  };

  const saveOrder = async (categories: TagCategory[]) => {
    if (!data) return;
    setData({ ...data, categories });
    await run(() => tagsApi.reorderCategories(categories.map((category) => category.id)));
  };

  const moveCategory = (categoryId: number, direction: -1 | 1) => {
    if (!data) return;
    const from = data.categories.findIndex((category) => category.id === categoryId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= data.categories.length) return;
    const next = [...data.categories];
    [next[from], next[to]] = [next[to], next[from]];
    saveOrder(next);
  };

  const dropCategory = (targetId: number) => {
    if (!data || draggedCategoryId == null || draggedCategoryId === targetId) return;
    const next = [...data.categories];
    const from = next.findIndex((category) => category.id === draggedCategoryId);
    const to = next.findIndex((category) => category.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraggedCategoryId(null);
    saveOrder(next);
  };

  const saveCollapsedLimit = (categoryId: number | null) => {
    if (!data) return;
    const key = groupKey(categoryId);
    const value = Number(limitDrafts[key]);
    if (!Number.isInteger(value) || value < 4 || value > 20) {
      setLimitDrafts((current) => ({
        ...current,
        [key]: String(categoryId == null
          ? data.collapsedLimit
          : data.categories.find((category) => category.id === categoryId)?.collapsed_limit ?? 8),
      }));
      setError("前台展示数量需要是 4–20 之间的整数");
      return;
    }
    const currentValue = categoryId == null
      ? data.collapsedLimit
      : data.categories.find((category) => category.id === categoryId)?.collapsed_limit;
    if (value === currentValue) return;
    run(() => categoryId == null
      ? tagsApi.updateDisplaySettings(value)
      : tagsApi.updateCategory(categoryId, { collapsedLimit: value }));
  };

  const renameTag = (tag: TagWithCount) => {
    if (!data) return;
    const name = window.prompt("新的标签名称（中英文、数字或下划线）", tag.name)?.trim().toLowerCase();
    if (!name || name === tag.name) return;
    const target = data.tags.find((item) => item.id !== tag.id && item.name === name);
    if (target && !window.confirm(`标签“${name}”已经存在，是否把“${tag.name}”合并进去？`)) return;
    run(() => tagsApi.rename(tag.id, name));
  };

  const deleteTag = (tag: TagWithCount) => {
    if (!window.confirm(
      `删除标签“${tag.name}”？这会从 ${tag.post_count} 篇关联动态及其正文中删除对应 hashtag，操作不可撤销。`
    )) return;
    setSelectedTagIdsByGroup((current) => Object.fromEntries(
      Object.entries(current).map(([key, ids]) => {
        const next = new Set(ids);
        next.delete(tag.id);
        return [key, next];
      })
    ));
    run(() => tagsApi.delete(tag.id));
  };

  const toggleExpanded = (categoryId: number | null) => {
    const key = groupKey(categoryId);
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderExpandedTags = (categoryId: number | null) => {
    const key = groupKey(categoryId);
    if (!expandedKeys.has(key) || !data) return null;
    const expandedTags = data.tags.filter((tag) => tag.category_id === categoryId);
    const selectedTagIds = selectedTagIdsByGroup[key] ?? new Set<number>();
    const moveTarget = moveTargets[key] ?? "";
    const allSelected = expandedTags.length > 0 && expandedTags.every((tag) => selectedTagIds.has(tag.id));
    const targetId = moveTarget === "" ? null : Number(moveTarget);
    const toggleAllExpandedTags = () => {
      setSelectedTagIdsByGroup((current) => ({
        ...current,
        [key]: allSelected ? new Set() : new Set(expandedTags.map((tag) => tag.id)),
      }));
    };
    const moveSelectedTags = () => {
      if (selectedTagIds.size === 0 || targetId === categoryId) return;
      run(() => tagsApi.moveMany(Array.from(selectedTagIds), targetId));
      setSelectedTagIdsByGroup((current) => ({ ...current, [key]: new Set() }));
    };
    return (
      <div className="border-t border-[#e6e7eb] px-3 pb-3 pt-3">
        {expandedTags.length === 0 ? (
          <p className="py-2 text-xs text-soft">这个分类还没有标签。</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex cursor-pointer items-center gap-2 text-[#1f2430]">
                <input type="checkbox" checked={allSelected} onChange={toggleAllExpandedTags} />
                全选
              </label>
              <span className="text-soft">已选 {selectedTagIds.size} 个</span>
              <div className="ml-auto flex min-w-0 items-center gap-2">
                <select
                  value={moveTarget}
                  onChange={(event) => setMoveTargets((current) => ({ ...current, [key]: event.target.value }))}
                  className="field-input min-w-0 px-2 py-1.5 text-xs"
                >
                  <option value="">未分类</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={moveSelectedTags}
                  disabled={busy || selectedTagIds.size === 0 || targetId === categoryId}
                  className="primary-action-button whitespace-nowrap px-3 py-1.5 text-xs"
                >
                  移动
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {expandedTags.map((tag) => (
                <div key={tag.id} className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[#f8f9fb] px-2.5 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedTagIds.has(tag.id)}
                    onChange={(event) => setSelectedTagIdsByGroup((current) => {
                      const next = new Set(current[key] ?? []);
                      if (event.target.checked) next.add(tag.id);
                      else next.delete(tag.id);
                      return { ...current, [key]: next };
                    })}
                  />
                  <span className="min-w-0 flex-1 truncate">#{tag.name}</span>
                  <span className="text-[10px] text-soft">{tag.post_count}</span>
                  <button type="button" onClick={() => renameTag(tag)} disabled={busy} className="text-xs font-semibold text-[#5d8fd6]">改名</button>
                  <button type="button" onClick={() => deleteTag(tag)} disabled={busy} className="text-xs font-semibold text-[#ef8f72]">删除</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[85] flex bg-black/45 sm:p-6">
      <div className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-[#f7f3ea] shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-[10px]">
        <header
          className="z-10 flex shrink-0 items-center justify-between gap-4 border-b border-[#d9dce4] bg-white px-4 pb-3 sm:px-6 sm:pt-3"
          style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}
        >
          <h2 className="text-xl font-semibold text-[#1f2430]">标签管理</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-lg text-soft hover:bg-gray-100" aria-label="关闭">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(1rem+var(--safe-bottom))] sm:p-5">
          {error && <div className="mb-3 rounded-[10px] bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {!data ? (
            <div className="h-40 animate-pulse rounded-[10px] bg-white/80" />
          ) : (
            <section className="surface-card-soft p-3 sm:p-4">
              <div className="mb-3 flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createCategory(); } }}
                  placeholder="新分类名称"
                  className="field-input min-w-0 flex-1 px-3 py-2 text-sm"
                  maxLength={40}
                />
                <button type="button" onClick={createCategory} disabled={busy || !newCategoryName.trim()} className="primary-action-button px-4 py-2 text-sm">新建</button>
              </div>

              <div className="space-y-2">
                {data.categories.map((category, index) => {
                  const count = data.tags.filter((tag) => tag.category_id === category.id).length;
                  const key = groupKey(category.id);
                  return (
                    <div
                      key={category.id}
                      draggable={!busy}
                      onDragStart={() => setDraggedCategoryId(category.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => dropCategory(category.id)}
                      className={`overflow-hidden rounded-[10px] border bg-white ${expandedKeys.has(key) ? "border-[#64b7ea]" : "border-[#e1e3e8]"}`}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpanded(category.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleExpanded(category.id);
                          }
                        }}
                        className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm"
                      >
                        <span className="cursor-grab text-soft" aria-hidden="true">⠿</span>
                        <span className="min-w-[7rem] flex-1 font-medium text-[#1f2430]">
                          {category.name} <span className="text-[10px] text-soft">({count})</span>
                        </span>
                        <div
                          className="flex flex-wrap items-center gap-2"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <label className="flex items-center gap-1 text-xs text-soft">
                            前台
                            <input
                              type="number"
                              min={4}
                              max={20}
                              value={limitDrafts[key] ?? "8"}
                              onChange={(event) => setLimitDrafts((current) => ({ ...current, [key]: event.target.value }))}
                              onBlur={() => saveCollapsedLimit(category.id)}
                              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                              className="field-input w-14 px-1.5 py-1 text-center text-xs"
                            />
                            个
                          </label>
                          <button type="button" onClick={() => moveCategory(category.id, -1)} disabled={busy || index === 0} className="px-1 text-soft disabled:opacity-30" aria-label="上移">↑</button>
                          <button type="button" onClick={() => moveCategory(category.id, 1)} disabled={busy || index === data.categories.length - 1} className="px-1 text-soft disabled:opacity-30" aria-label="下移">↓</button>
                          <button type="button" onClick={() => renameCategory(category)} disabled={busy} className="text-xs font-semibold text-[#5d8fd6]">改名</button>
                          <button type="button" onClick={() => deleteCategory(category)} disabled={busy} className="text-xs font-semibold text-[#ef8f72]">删除</button>
                          <button type="button" onClick={() => toggleExpanded(category.id)} className="w-5 text-sm text-[#5d8fd6]" aria-label={expandedKeys.has(key) ? "收起" : "展开"}>
                            {expandedKeys.has(key) ? "⌃" : "⌄"}
                          </button>
                        </div>
                      </div>
                      {renderExpandedTags(category.id)}
                    </div>
                  );
                })}

                <div className={`overflow-hidden rounded-[10px] border border-dashed bg-white ${expandedKeys.has("uncategorized") ? "border-[#64b7ea]" : "border-[#d9dce4]"}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpanded(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpanded(null);
                      }
                    }}
                    className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-[7rem] flex-1 font-medium text-[#1f2430]">
                      未分类 <span className="text-[10px] text-soft">({data.tags.filter((tag) => tag.category_id == null).length})</span>
                    </span>
                    <div
                      className="flex items-center gap-2"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <label className="flex items-center gap-1 text-xs text-soft">
                        前台
                        <input
                          type="number"
                          min={4}
                          max={20}
                          value={limitDrafts.uncategorized ?? "8"}
                          onChange={(event) => setLimitDrafts((current) => ({ ...current, uncategorized: event.target.value }))}
                          onBlur={() => saveCollapsedLimit(null)}
                          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                          className="field-input w-14 px-1.5 py-1 text-center text-xs"
                        />
                        个
                      </label>
                      <button type="button" onClick={() => toggleExpanded(null)} className="w-5 text-sm text-[#5d8fd6]" aria-label={expandedKeys.has("uncategorized") ? "收起" : "展开"}>
                        {expandedKeys.has("uncategorized") ? "⌃" : "⌄"}
                      </button>
                    </div>
                  </div>
                  {renderExpandedTags(null)}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
