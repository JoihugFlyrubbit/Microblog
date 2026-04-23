"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackToTopButton } from "@/components/BackToTopButton";
import { EnvironmentHeaderBadge } from "@/components/EnvironmentHeaderBadge";
import { authApi, Post, User } from "@/lib/api";
import { Calendar } from "@/components/Calendar";
import { ExportButton } from "@/components/ExportButton";
import { PostDetailModal } from "@/components/PostDetailModal";
import { PostForm } from "@/components/PostForm";
import { PostList } from "@/components/PostList";
import { PinnedPosts } from "@/components/PinnedPosts";
import { TagCloud } from "@/components/TagCloud";

type Filters = {
  selectedDate?: string;
  selectedTag?: string;
};

export function AdminHome() {
  const router = useRouter();
  const [session, setSession] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [editingOnOpen, setEditingOnOpen] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const postFormRef = useRef<HTMLDivElement | null>(null);
  const alignToContentTop = () => {
    const target = streamRef.current || contentRef.current;
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  useEffect(() => {
    document.title = "我的微博";
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const headerOffset = 74;
      const contentTop = contentRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      setIsScrolled(contentTop <= headerOffset);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await authApi.getSession();
        if (res.success && res.data?.isLoggedIn) {
          setSession(res.data.user);
          return;
        }
      } catch (error) {
        console.error("Admin session check failed:", error);
      }

      router.replace("/login");
    };

    checkSession().finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalHtmlTouchAction = document.documentElement.style.touchAction;

    if (selectedPostId) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.touchAction = "none";
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.touchAction = originalHtmlTouchAction;
    };
  }, [selectedPostId]);

  useEffect(() => {
    if (!showPostForm) return;
    requestAnimationFrame(() => {
      postFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [showPostForm]);

  const handleLogout = async () => {
    await authApi.logout();
    router.replace("/login");
  };

  const handleDateSelect = (date?: string) => {
    setFilters({
      selectedDate: filters.selectedDate === date ? undefined : date,
      selectedTag: undefined,
    });
    requestAnimationFrame(alignToContentTop);
  };

  const handleTagSelect = (tag?: string) => {
    setFilters({
      selectedDate: undefined,
      selectedTag: filters.selectedTag === tag ? undefined : tag,
    });
    requestAnimationFrame(alignToContentTop);
  };

  const clearFilters = () => {
    setFilters({});
    setRefreshKey((value) => value + 1);
    requestAnimationFrame(alignToContentTop);
  };

  const handlePostTagClick = (tag: string) => {
    setSelectedPostId(null);
    handleTagSelect(tag);
  };

  const handlePostSuccess = () => {
    setShowPostForm(false);
    setFilters({});
    setRefreshKey((value) => value + 1);
  };

  const handlePostDelete = () => {
    setSelectedPostId(null);
    setRefreshKey((value) => value + 1);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen">
      <header className={`glass-header sticky top-0 z-30 ${isScrolled ? "border-b border-[#d9dce4]/80" : "border-b border-transparent"}`}>
        <div className="shell grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_auto_1fr] sm:py-4">
          <a
            href="/admin"
            className={`justify-self-start text-[1rem] font-medium tracking-[-0.03em] text-[#1f2430] transition-all duration-300 sm:text-[1.15rem] ${
              isScrolled ? "opacity-100" : "opacity-88"
            }`}
          >
            Home
          </a>
          <EnvironmentHeaderBadge />
          <div className="flex items-center justify-self-end gap-3 sm:gap-4">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-[#64b7ea] hover:text-[#4c9ecf]"
            >
              <span className="hidden sm:inline">公开首页</span>
              <span className="sm:hidden">公开</span>
            </a>
            <span className="hidden text-sm text-soft sm:inline">
              @{session.username}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm font-semibold text-[#ef8f72] hover:text-[#d86d55]"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="safe-bottom-pad pb-24 pt-6 sm:pt-10">
        <section className="shell space-y-6">
          {!showPostForm && (
            <button
              onClick={() => setShowPostForm(true)}
              className="surface-card-soft w-full border border-dashed border-white/90 py-4 text-base font-semibold text-[#1f2430] hover:text-[#64b7ea]"
            >
              + 发布新动态
            </button>
          )}

          <div
            ref={postFormRef}
            style={{ scrollMarginTop: "calc(92px + env(safe-area-inset-top, 0px))" }}
          >
            {showPostForm && (
              <PostForm
                onSuccess={handlePostSuccess}
                onCancel={() => setShowPostForm(false)}
              />
            )}
          </div>

          <div ref={contentRef} className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
            <div className="hidden lg:col-span-1 lg:self-start lg:block">
              <div className="space-y-5 lg:sticky lg:top-[4.8rem] lg:h-fit">
                <PinnedPosts
                  visibility="all"
                  date={filters.selectedDate}
                  tag={filters.selectedTag}
                  refreshKey={refreshKey}
                  onPostClick={(post: Post) => setSelectedPostId(post.id)}
                  onTagClick={handlePostTagClick}
                />
                <div className="surface-card animate-rise-in p-5 transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]">
                  <Calendar
                    selectedDate={filters.selectedDate}
                    onDateSelect={handleDateSelect}
                    includePrivate
                    refreshKey={refreshKey}
                  />
                </div>
                <div className="surface-card animate-rise-in p-5 transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]" style={{ animationDelay: "80ms" }}>
                  <TagCloud
                    selectedTag={filters.selectedTag}
                    onTagSelect={handleTagSelect}
                    includePrivate
                    refreshKey={refreshKey}
                  />
                </div>
                <div className="surface-card animate-rise-in p-5 transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]" style={{ animationDelay: "140ms" }}>
                  <ExportButton />
                </div>
              </div>
            </div>

            <div className="space-y-4 lg:hidden">
              <PinnedPosts
                visibility="all"
                date={filters.selectedDate}
                tag={filters.selectedTag}
                refreshKey={refreshKey}
                onPostClick={(post: Post) => setSelectedPostId(post.id)}
                onTagClick={handlePostTagClick}
              />
              <details className="mobile-panel" open={Boolean(filters.selectedDate)}>
                <summary className="mobile-panel-summary">
                  <span>日期筛选</span>
                  <span className="text-xs text-soft">{filters.selectedDate ?? "按天查看"}</span>
                </summary>
                <div className="mobile-panel-body">
                  <Calendar
                    selectedDate={filters.selectedDate}
                    onDateSelect={handleDateSelect}
                    includePrivate
                    refreshKey={refreshKey}
                  />
                </div>
              </details>
              <details className="mobile-panel" open={Boolean(filters.selectedTag)}>
                <summary className="mobile-panel-summary">
                  <span>标签筛选</span>
                  <span className="text-xs text-soft">{filters.selectedTag ? `#${filters.selectedTag}` : "展开标签"}</span>
                </summary>
                <div className="mobile-panel-body">
                  <TagCloud
                    selectedTag={filters.selectedTag}
                    onTagSelect={handleTagSelect}
                    includePrivate
                    refreshKey={refreshKey}
                  />
                </div>
              </details>
              <details className="mobile-panel">
                <summary className="mobile-panel-summary">
                  <span>导出</span>
                  <span className="text-xs text-soft">备份与归档</span>
                </summary>
                <div className="mobile-panel-body">
                  <ExportButton />
                </div>
              </details>
            </div>

            <div ref={streamRef} className="min-w-0 self-start animate-rise-in" style={{ animationDelay: "160ms" }}>
              {(filters.selectedDate || filters.selectedTag) && (
                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-soft">当前筛选</span>
                  {filters.selectedDate && (
                    <span className="filter-pill text-[#64b7ea]">
                      日期: {filters.selectedDate}
                    </span>
                  )}
                  {filters.selectedTag && (
                    <span className="filter-pill text-[#68c7b8]">
                      标签: #{filters.selectedTag}
                    </span>
                  )}
                  <button
                    onClick={clearFilters}
                    className="text-sm font-semibold text-[#ef8f72] hover:text-[#d86d55]"
                  >
                    清除筛选
                  </button>
                </div>
              )}

              <PostList
                key={`admin-${refreshKey}`}
                visibility="all"
                date={filters.selectedDate}
                tag={filters.selectedTag}
                canManage
                onRefresh={() => setRefreshKey((value) => value + 1)}
                onPostClick={(post: Post) => { setEditingOnOpen(false); setSelectedPostId(post.id); }}
                onPostEdit={(post: Post) => { setEditingOnOpen(true); setSelectedPostId(post.id); }}
                onTagClick={handlePostTagClick}
              />
            </div>
          </div>
        </section>
      </main>

      <BackToTopButton />

      {selectedPostId && (
        <PostDetailModal
          postId={selectedPostId}
          onClose={() => { setSelectedPostId(null); setEditingOnOpen(false); }}
          onDelete={handlePostDelete}
          onPinChange={() => setRefreshKey((value) => value + 1)}
          onTagClick={handlePostTagClick}
          canManage
          initialEditing={editingOnOpen}
        />
      )}
    </div>
  );
}
