"use client";

import { useEffect, useRef, useState } from "react";
import { BackToTopButton } from "@/components/BackToTopButton";
import { BrandMark } from "@/components/BrandMark";
import { Post } from "@/lib/api";
import { Calendar } from "@/components/Calendar";
import { EnvironmentHeaderBadge } from "@/components/EnvironmentHeaderBadge";
import { PostDetailModal } from "@/components/PostDetailModal";
import { PostList } from "@/components/PostList";
import { PinnedPosts } from "@/components/PinnedPosts";
import { TagCloud } from "@/components/TagCloud";

type Filters = {
  selectedDate?: string;
  selectedTag?: string;
};

export function PublicHome() {
  const [filters, setFilters] = useState<Filters>({});
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const alignToContentTop = () => {
    const target = streamRef.current || contentRef.current;
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  useEffect(() => {
    document.title = "Joi的Microblog";
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

  return (
    <div className="min-h-screen">
      <header className={`glass-header sticky top-0 z-30 ${isScrolled ? "border-b border-[#d9dce4]/80" : "border-b border-transparent"}`}>
        <div className="shell grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_auto_1fr] sm:py-4">
          <a
            href="/"
            className={`justify-self-start text-[1rem] font-medium tracking-[-0.03em] text-[#1f2430] transition-all duration-300 sm:text-[1.15rem] ${
              isScrolled ? "opacity-100" : "opacity-88"
            }`}
          >
            Home
          </a>
          <EnvironmentHeaderBadge />
          <a
            href="/login"
            className="justify-self-end rounded-full border border-[#d9dce4] bg-white px-4 py-2.5 text-sm font-medium text-[#1f2430] sm:px-6 sm:py-3"
          >
            Login
          </a>
        </div>
      </header>

      <main className="safe-bottom-pad pb-20">
        <section className="sticky z-0 flex min-h-[42vh] items-center bg-[#f7f3ea] sm:min-h-[62vh]" style={{ top: "calc(65px + env(safe-area-inset-top, 0px))" }}>
          <div className="shell flex flex-col items-center justify-center gap-6 py-8 text-center sm:gap-8 sm:py-10">
            <div className="animate-rise-in animate-soft-float">
              <BrandMark
                subtitle="welcome to my little world❤️"
              />
            </div>
          </div>
        </section>

        <section ref={contentRef} className="relative z-20 bg-[#f7f3ea] pt-10 sm:pt-20">
          <div aria-hidden="true" className="-mb-8 sticky z-10 h-8 -translate-y-full bg-[#f7f3ea]" style={{ top: "calc(65px + env(safe-area-inset-top, 0px))" }} />
          <div className="shell grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          <div className="hidden lg:col-span-1 lg:self-start lg:block">
            <div className="space-y-5 lg:sticky lg:top-[4.8rem] lg:h-fit">
              <PinnedPosts
                visibility="public"
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
                  includePrivate={false}
                />
              </div>
              <div className="surface-card animate-rise-in p-5 transition-shadow duration-200 hover:shadow-[0_24px_42px_rgba(83,84,92,0.16)]" style={{ animationDelay: "80ms" }}>
                <TagCloud
                  selectedTag={filters.selectedTag}
                  onTagSelect={handleTagSelect}
                  includePrivate={false}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 lg:hidden">
            <PinnedPosts
              visibility="public"
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
                  includePrivate={false}
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
                  includePrivate={false}
                />
              </div>
            </details>
          </div>

          <div ref={streamRef} className="min-w-0 self-start animate-rise-in" style={{ animationDelay: "120ms" }}>
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
              key={`public-${refreshKey}`}
              visibility="public"
              date={filters.selectedDate}
              tag={filters.selectedTag}
              onPostClick={(post: Post) => setSelectedPostId(post.id)}
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
          onClose={() => setSelectedPostId(null)}
          onPinChange={() => setRefreshKey((value) => value + 1)}
          onTagClick={handlePostTagClick}
          canManage={false}
        />
      )}
    </div>
  );
}
