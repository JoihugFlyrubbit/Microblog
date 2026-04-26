"use client";

import { useState, useEffect, useCallback } from "react";
import { postsApi, Post, PostsListResponse } from "@/lib/api";
import { PostCard } from "./PostCard";

interface PostListProps {
  date?: string;
  tag?: string;
  visibility?: 'all' | 'public' | 'private';
  pinned?: boolean;
  canManage?: boolean;
  onRefresh?: () => void;
  onPostClick?: (post: Post) => void;
  onPostEdit?: (post: Post) => void;
  onTagClick?: (tag: string) => void;
}

export function PostList({ date, tag, visibility = 'public', pinned, canManage = false, onRefresh, onPostClick, onPostEdit, onTagClick }: PostListProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [pagination, setPagination] = useState<PostsListResponse['pagination'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await postsApi.list({
        page: currentPage,
        date,
        tag,
        visibility,
        pinned,
      });

      if (res.success && res.data) {
        setPosts(res.data.posts);
        setPagination(res.data.pagination);
      } else {
        setError(res.error?.message || 'Failed to load posts');
      }
    } catch {
      setError('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [currentPage, date, tag, visibility, pinned]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  if (loading && posts.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="surface-card animate-pulse p-6">
            <div className="mb-4 h-4 w-1/4 rounded bg-white/90"></div>
            <div className="h-20 rounded bg-white/80"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-card rounded-[5px] border border-red-100 bg-red-50/90 p-6 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={loadPosts}
          className="rounded-full bg-red-600 px-5 py-2 text-white hover:bg-red-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="surface-card-soft border border-dashed border-white/90 p-12 text-center">
        <p className="mb-2 text-lg font-semibold text-[#1f2430]">还没有动态</p>
        <p className="text-sm text-soft">
          {date ? `所选日期 (${date}) 没有发布内容` : tag ? `标签 #${tag} 下没有内容` : '开始发布你的第一条动态吧'}
        </p>
      </div>
    );
  }

  // 分页控件：纯文字「上一页 / 第 X/Y 页（条数可选）/ 下一页」。
  // compact=true 时省略 "(X 条)"（用于顶部行，旁边已显示"共 X 条"避免重复）。
  const renderPaginator = (compact: boolean) => (
    <div className="flex items-center gap-3 text-sm">
      <button
        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        className="text-[#5d8fd6] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
      >
        上一页
      </button>
      <span className="text-soft">
        第 {currentPage} / {pagination!.totalPages} 页
        {!compact && ` (${pagination!.total} 条)`}
      </span>
      <button
        onClick={() => setCurrentPage((p) => Math.min(pagination!.totalPages, p + 1))}
        disabled={currentPage === pagination!.totalPages}
        className="text-[#5d8fd6] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
      >
        下一页
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {pagination && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-soft">共 {pagination.total} 条</p>
          {pagination.totalPages > 1 && renderPaginator(true)}
        </div>
      )}
      {/* Posts */}
      <div className="space-y-4">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onClick={() => onPostClick?.(post)}
            onTagClick={onTagClick}
            compact
            flushBottom
            canManage={canManage}
            onRefresh={onRefresh}
            onEdit={onPostEdit ? () => onPostEdit(post) : undefined}
          />
        ))}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center pt-4">
          {renderPaginator(false)}
        </div>
      )}

      {pagination && currentPage === pagination.totalPages && (
        <p className="pt-3 text-center text-xs tracking-[0.14em] text-soft">
          没有更多了
        </p>
      )}
    </div>
  );
}
