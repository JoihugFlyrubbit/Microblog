"use client";

import Image from "next/image";
import { postsApi, Post, PostWithRelations } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PostCardProps {
  post: Post | PostWithRelations;
  onClick?: () => void;
  compact?: boolean;
  wideMedia?: boolean;
  flushBottom?: boolean;
  onTagClick?: (tag: string) => void;
  detail?: boolean;
  canManage?: boolean;
  onRefresh?: () => void;
  onEdit?: () => void;
  carousel?: boolean;
}

export function PostCard({ post, onClick, compact = false, wideMedia = false, flushBottom = false, onTagClick, detail = false, canManage = false, onRefresh, onEdit, carousel = false }: PostCardProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAppends, setShowAppends] = useState(false);
  const [loadedPost, setLoadedPost] = useState<PostWithRelations | null>(isPostWithRelations(post) ? (post as PostWithRelations) : null);
  const [loadingAppends, setLoadingAppends] = useState(false);
  const [togglingPin, setTogglingPin] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAppendForm, setShowAppendForm] = useState(false);
  const [appendContent, setAppendContent] = useState("");
  const [submittingAppend, setSubmittingAppend] = useState(false);
  const [scrollToLastAppend, setScrollToLastAppend] = useState(false);
  const lastAppendRef = useRef<HTMLDivElement | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const hasPostRelations = 'appends' in post;
  const compactPreview = !hasPostRelations && post.preview_media_url
    ? [{ id: `preview-${post.id}`, url: post.preview_media_url, type: post.preview_media_type || "image" }]
    : [];
  const mediaItems = hasPostRelations ? post.media : compactPreview;
  const showMetaBeforeAppends = detail && hasPostRelations && post.appends.length > 0;
  const currentPost = loadedPost || (post as Post | PostWithRelations);
  const currentHasRelations = isPostWithRelations(currentPost);
  const currentAppends = currentHasRelations ? currentPost.appends : [];
  const currentMediaItems = currentHasRelations ? currentPost.media : mediaItems;
  const appendCount = currentHasRelations
    ? currentAppends.length
    : (hasPostRelations ? (post as PostWithRelations).appends.length : (post.append_count || 0));
  const contentShouldClamp = compact && !expanded && currentPost.content.length > 110;

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (hasPostRelations) {
      setLoadedPost(post as PostWithRelations);
    } else {
      setLoadedPost(null);
    }
  }, [post, hasPostRelations]);

  useEffect(() => {
    if (hasPostRelations || !compact || detail || (post.media_count || 0) <= 1) {
      return;
    }

    void refreshRelations();
  }, [compact, detail, hasPostRelations, post]);

  useEffect(() => {
    if (lightboxIndex === null) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxIndex(null);
        setLightboxScale(1);
        return;
      }

      if (event.key === "ArrowLeft") {
        setLightboxIndex((value) => {
          if (value === null || currentMediaItems.length <= 1) return value;
          return value === 0 ? currentMediaItems.length - 1 : value - 1;
        });
      }

      if (event.key === "ArrowRight") {
        setLightboxIndex((value) => {
          if (value === null || currentMediaItems.length <= 1) return value;
          return value === currentMediaItems.length - 1 ? 0 : value + 1;
        });
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [lightboxIndex, currentMediaItems.length]);

  useEffect(() => {
    if (lightboxIndex !== null) {
      setLightboxScale(1);
    }
  }, [lightboxIndex]);

  useEffect(() => {
    if (!scrollToLastAppend || !showAppends) return;
    if (!lastAppendRef.current) return;
    lastAppendRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollToLastAppend(false);
  }, [scrollToLastAppend, showAppends, loadedPost]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const activeLightboxItem = lightboxIndex !== null ? currentMediaItems[lightboxIndex] : null;
  const mediaCount = currentMediaItems.length;
  const useGalleryGrid = mediaCount > 1;
  const shouldWaitForGallery = compact && !detail && !currentHasRelations && (post.media_count || 0) > 1;

  async function ensureRelationsLoaded() {
    if (currentHasRelations) return;
    setLoadingAppends(true);
    try {
      const res = await postsApi.get(post.id);
      if (res.success && res.data) {
        setLoadedPost(res.data.post);
      }
    } finally {
      setLoadingAppends(false);
    }
  }

  async function refreshRelations() {
    setLoadingAppends(true);
    try {
      const res = await postsApi.get(post.id);
      if (res.success && res.data) {
        setLoadedPost(res.data.post);
        return res.data.post;
      }
      return null;
    } finally {
      setLoadingAppends(false);
    }
  }

  const handleToggleAppends = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!showAppends) {
      await ensureRelationsLoaded();
    }
    setShowAppends((value) => !value);
  };

  const handleTogglePin = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setTogglingPin(true);
    try {
      await postsApi.setPinned(post.id, !(currentPost.pinned === 1));
      onRefresh?.();
    } finally {
      setTogglingPin(false);
    }
  };

  const handleToggleVisibility = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextVisibility = currentPost.visibility === 'public' ? 'private' : 'public';
    const confirmed = confirm(
      nextVisibility === 'private' ? '确定将这条动态改为私密吗？' : '确定将这条动态改为公开吗？'
    );
    if (!confirmed) return;

    setTogglingVisibility(true);
    try {
      await postsApi.setVisibility(post.id, nextVisibility);
      onRefresh?.();
    } finally {
      setTogglingVisibility(false);
    }
  };

  const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!confirm("确定要删除这条动态吗？此操作不可撤销。")) return;
    setDeleting(true);
    try {
      await postsApi.delete(post.id);
      onRefresh?.();
    } finally {
      setDeleting(false);
    }
  };

  const handleAddAppend = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!appendContent.trim()) return;
    setSubmittingAppend(true);
    try {
      const res = await postsApi.addAppend(post.id, appendContent.trim());
      if (res.success) {
        setAppendContent("");
        setShowAppendForm(false);
        await refreshRelations();
        setShowAppends(true);
        setScrollToLastAppend(true);
      }
    } finally {
      setSubmittingAppend(false);
    }
  };

  const handleDeleteAppend = async (event: React.MouseEvent<HTMLButtonElement>, appendId: number) => {
    event.stopPropagation();
    await postsApi.deleteAppend(post.id, appendId);
    if (loadedPost) {
      const nextAppends = loadedPost.appends.filter((append) => append.id !== appendId);
      setLoadedPost({
        ...loadedPost,
        appends: nextAppends,
      });
      setShowAppends(nextAppends.length > 0);
    } else {
      const refreshed = await refreshRelations();
      setShowAppends(Boolean(refreshed && refreshed.appends.length > 0));
    }
    onRefresh?.();
  };

  // Extract hashtags from content
  const renderContent = (content: string) => {
    const parts = content.split(/(#[\w\u4e00-\u9fa5]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        const tagName = part.slice(1); // Remove #
        return (
          <span
            key={i}
            className="cursor-pointer text-[#5d8fd6] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onTagClick?.(tagName);
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <article
      onClick={onClick}
      className={`
        ${detail ? "bg-transparent" : "surface-card border-white/90"}
        ${onClick ? 'cursor-pointer transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]' : ''}
        ${compact
          ? flushBottom
            ? 'px-5 pt-5 pb-2 sm:px-6 sm:pt-6 sm:pb-2'
            : 'px-5 py-5 sm:px-6 sm:py-6'
          : 'p-6 sm:p-7'}
      `}
    >
      <div className={`
        whitespace-pre-wrap text-[1.03rem] leading-8 text-[#1f2430]
        ${contentShouldClamp ? 'line-clamp-4' : ''}
      `}>
        {renderContent(currentPost.content)}
      </div>

      {compact && currentPost.content.length > 110 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className="mt-2 text-sm font-medium text-[#5d8fd6] hover:underline"
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}

      {/* Media */}
      {shouldWaitForGallery && !carousel && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="aspect-square rounded-[10px] bg-white/70" />
          ))}
        </div>
      )}

      {currentMediaItems.length > 0 && carousel && (
        <div className="relative mt-4 overflow-hidden rounded-[10px] bg-white">
          {(() => {
            const safeIndex = Math.min(carouselIndex, mediaCount - 1);
            const item = currentMediaItems[safeIndex];
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(safeIndex);
                }}
                className="block w-full"
              >
                {item.type === "image" ? (
                  <Image
                    src={item.url}
                    alt=""
                    width={1600}
                    height={1600}
                    sizes="(min-width: 1024px) 260px, 100vw"
                    className="h-auto w-full object-contain"
                    unoptimized
                  />
                ) : (
                  <video src={item.url} className="h-auto w-full object-contain" />
                )}
              </button>
            );
          })()}
          {mediaCount > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCarouselIndex((value) => (value === 0 ? mediaCount - 1 : value - 1));
                }}
                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-lg leading-none text-white hover:bg-black/60"
                aria-label="上一张"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCarouselIndex((value) => (value === mediaCount - 1 ? 0 : value + 1));
                }}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-lg leading-none text-white hover:bg-black/60"
                aria-label="下一张"
              >
                ›
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2 py-0.5 text-xs text-white">
                {Math.min(carouselIndex, mediaCount - 1) + 1} / {mediaCount}
              </div>
            </>
          )}
        </div>
      )}

      {!shouldWaitForGallery && currentMediaItems.length > 0 && !carousel && (
        <div className="mt-4">
          <div
            className={
              useGalleryGrid
                ? "grid grid-cols-3 gap-2 sm:gap-3"
                : mediaCount === 1 && currentMediaItems[0]?.type === "image"
                  ? "grid grid-cols-3 gap-2 sm:gap-3"
                  : `grid gap-3 ${wideMedia ? "grid-cols-1" : "grid-cols-1"}`
            }
          >
            {currentMediaItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(index);
                }}
                className={`relative overflow-hidden bg-white ${
                  useGalleryGrid
                    ? "aspect-square rounded-[10px]"
                    : mediaCount === 1 && item.type === "image"
                      ? "col-span-1 self-start rounded-[10px]"
                      : item.type === "image"
                        ? "w-full rounded-[10px]"
                      : "aspect-video rounded-[10px]"
                }`}
              >
                {item.type === 'image' ? (
                  <Image
                    src={item.url}
                    alt=""
                    width={1600}
                    height={1600}
                    sizes={useGalleryGrid ? "(min-width: 1024px) 180px, 33vw" : "(min-width: 1024px) 184px, 33vw"}
                    className={useGalleryGrid ? "h-full w-full object-cover" : "h-auto w-full object-contain"}
                    unoptimized
                  />
                ) : (
                  <video
                    src={item.url}
                    className="h-full w-full object-cover"
                  />
                )}
                {useGalleryGrid && index === 8 && mediaCount > 9 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-lg font-semibold text-white">
                    +{mediaCount - 9}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {showMetaBeforeAppends && (
        <div className="mt-5 flex items-end justify-between gap-4 text-sm text-soft">
          <div className="flex items-center gap-1 leading-none">
            {appendCount > 0 && <span>{appendCount} 条补充</span>}
            {currentPost.visibility === 'private' && (
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1f2430]/8 text-[#6f7684]"
                aria-label="私密"
                title="私密"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                  <path d="M10 2a4 4 0 0 0-4 4v2H5.5A1.5 1.5 0 0 0 4 9.5v6A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14.5 8H14V6a4 4 0 0 0-4-4Zm-2.5 6V6a2.5 2.5 0 0 1 5 0v2h-5Z" />
                </svg>
              </span>
            )}
          </div>
          <span>{formatDate(post.created_at)}</span>
        </div>
      )}

      {/* Appends (if available and not compact) */}
      {!compact && !detail && currentHasRelations && currentAppends.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="border-t pt-3">
            <div className="space-y-2">
              {currentAppends.map((append) => (
                <div
                  key={append.id}
                  className="rounded-none bg-white/82 p-4 text-sm"
                >
                  <div className="mb-1 text-xs text-soft">
                    {formatDate(append.created_at)}
                  </div>
                  <div className="text-[#1f2430]">{append.content}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-soft">
        <div className="flex items-center gap-1 leading-none">
          {currentPost.visibility === 'private' && !canManage && !showMetaBeforeAppends && (
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1f2430]/8 text-[#6f7684]"
              aria-label="私密"
              title="私密"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M10 2a4 4 0 0 0-4 4v2H5.5A1.5 1.5 0 0 0 4 9.5v6A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14.5 8H14V6a4 4 0 0 0-4-4Zm-2.5 6V6a2.5 2.5 0 0 1 5 0v2h-5Z" />
              </svg>
            </span>
          )}
          {appendCount > 0 && !showMetaBeforeAppends && (
            <button
              type="button"
              onClick={handleToggleAppends}
              className="text-left hover:text-[#1f2430]"
            >
              {showAppends ? "收起补充" : `${appendCount} 条补充`}
            </button>
          )}
        </div>
        {!showMetaBeforeAppends && <span className="leading-none text-soft">{formatDate(currentPost.created_at)}</span>}
      </div>

      {compact && showAppends && (
        <div className="mt-4 pt-3">
          {loadingAppends ? (
            <p className="text-sm text-soft">加载补充中...</p>
          ) : currentHasRelations && currentAppends.length > 0 ? (
            <div className="space-y-2">
              {currentAppends.map((append, index) => (
                <div
                  key={append.id}
                  ref={index === currentAppends.length - 1 ? lastAppendRef : null}
                  className="rounded-[5px] bg-gray-50 p-4 text-sm"
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs text-soft">
                    <span>{formatDate(append.created_at)}</span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={(event) => handleDeleteAppend(event, append.id)}
                        className="text-[#ef8f72] hover:underline"
                      >
                        删除补充
                      </button>
                    )}
                  </div>
                  <div className="overflow-hidden whitespace-pre-wrap break-words text-[#1f2430]">{append.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-soft">还没有补充</p>
          )}
        </div>
      )}

      {canManage && compact && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-2 text-[0.88rem] leading-6">
          <button
            type="button"
            onClick={handleToggleVisibility}
            disabled={togglingVisibility}
            className="inline-flex h-7 w-7 items-center justify-center text-[#6f7684] disabled:opacity-50"
            aria-label={currentPost.visibility === 'public' ? '当前公开，点击改为私密' : '当前私密，点击改为公开'}
            title={currentPost.visibility === 'public' ? '当前公开，点击改为私密' : '当前私密，点击改为公开'}
          >
            {currentPost.visibility === 'public' ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 10V7.5a4 4 0 1 1 8 0V10h-2V7.5a2 2 0 1 0-4 0V10h4.5A1.5 1.5 0 0 1 16 11.5V18a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 6 18v-6.5A1.5 1.5 0 0 1 7.5 10H8Zm0 1.8v5.9h6v-5.9H8Z" />
                <path d="M16 6.7c2.2 0 4 1.8 4 4v2.6h-1.8v-2.6c0-1.2-1-2.2-2.2-2.2V6.7Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M10 2a4 4 0 0 0-4 4v2H5.5A1.5 1.5 0 0 0 4 9.5v6A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 14.5 8H14V6a4 4 0 0 0-4-4Zm-2.5 6V6a2.5 2.5 0 0 1 5 0v2h-5Z" />
              </svg>
            )}
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              className="text-[#5d8fd6] hover:underline"
            >
              编辑
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowAppendForm((value) => !value);
            }}
            className="text-[#64b7ea] hover:underline"
          >
            {showAppendForm ? '收起补充框' : '添加补充'}
          </button>
          <button
            type="button"
            onClick={handleTogglePin}
            disabled={togglingPin}
            className="text-[#68c7b8] hover:underline disabled:opacity-50"
          >
            {currentPost.pinned === 1 ? '取消置顶' : '置顶'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-[#ef8f72] hover:underline disabled:opacity-50"
          >
            删除
          </button>
        </div>
      )}

      {canManage && compact && showAppendForm && (
        <div className="mt-4 rounded-[5px] bg-white/82 p-4" onClick={(event) => event.stopPropagation()}>
          <textarea
            value={appendContent}
            onChange={(event) => setAppendContent(event.target.value)}
            placeholder="补充内容..."
            rows={3}
            className="field-input w-full resize-none px-3 py-2"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAppendForm(false);
                setAppendContent("");
              }}
              className="px-3 py-1.5 text-sm text-soft hover:text-[#1f2430]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleAddAppend}
              disabled={!appendContent.trim() || submittingAppend}
              className="primary-action-button px-4 py-1.5 text-sm"
            >
              {submittingAppend ? "发布中..." : "发布补充"}
            </button>
          </div>
        </div>
      )}

      {mounted && activeLightboxItem && createPortal(
        <div
          className="fixed inset-x-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          style={{
            top: "calc(-1 * var(--safe-top))",
            bottom: "calc(-1 * var(--safe-bottom))",
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) {
              setLightboxIndex(null);
              setLightboxScale(1);
            }
          }}
        >
          <div className="relative flex h-[min(84vh,calc(100dvh-2rem))] w-full max-w-5xl items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setLightboxIndex(null);
                setLightboxScale(1);
              }}
              className="absolute right-3 top-3 z-[91] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-3xl leading-none text-white"
              aria-label="关闭预览"
            >
              ×
            </button>
            {currentMediaItems.length > 1 && (
              <>
                <div className="absolute left-3 top-3 z-[91] rounded-full bg-black/55 px-3 py-1 text-sm text-white">
                  {lightboxIndex! + 1} / {currentMediaItems.length}
                </div>
                <button
                  type="button"
                  onClick={() => setLightboxIndex((value) => (value === null ? 0 : value === 0 ? currentMediaItems.length - 1 : value - 1))}
                  className="absolute left-3 top-1/2 z-[91] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl text-white"
                  aria-label="上一张"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxIndex((value) => (value === null ? 0 : value === currentMediaItems.length - 1 ? 0 : value + 1))}
                  className="absolute right-3 top-1/2 z-[91] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl text-white"
                  aria-label="下一张"
                >
                  ›
                </button>
              </>
            )}
            {activeLightboxItem.type === "image" ? (
              <>
                <div className="pointer-events-none z-[89] flex h-full w-full items-center justify-center px-12 py-14 sm:px-16 sm:py-16">
                  <Image
                    src={activeLightboxItem.url}
                    alt=""
                    width={1800}
                    height={1800}
                    sizes="100vw"
                    className="max-h-full w-full object-contain transition-transform duration-200"
                    style={{ transform: `scale(${lightboxScale})` }}
                    unoptimized
                  />
                </div>
                <div className="absolute bottom-3 left-1/2 z-[91] flex -translate-x-1/2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLightboxScale((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-2xl text-white"
                    aria-label="缩小"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxScale((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-2xl text-white"
                    aria-label="放大"
                  >
                    +
                  </button>
                </div>
              </>
            ) : (
              <video
                src={activeLightboxItem.url}
                controls
                autoPlay
                className="max-h-[84vh] w-full object-contain"
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </article>
  );
}

function isPostWithRelations(post: Post | PostWithRelations): post is PostWithRelations {
  return 'appends' in post;
}
