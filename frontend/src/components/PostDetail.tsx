"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { postsApi, PostWithRelations } from "@/lib/api";
import { PostCard, MarkdownContent } from "./PostCard";
import { PostForm } from "./PostForm";
import { formatBeijingDateTime } from "@/lib/time";

interface PostDetailProps {
  postId: number;
  onClose?: () => void;
  onDelete?: () => void;
  onPinChange?: () => void;
  onTagClick?: (tag: string) => void;
  onUpdate?: () => void;
  canManage?: boolean;
  initialEditing?: boolean;
}

export function PostDetail({ postId, onClose, onDelete, onPinChange, onTagClick, onUpdate, canManage = false, initialEditing = false }: PostDetailProps) {
  const [post, setPost] = useState<PostWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAppendForm, setShowAppendForm] = useState(false);
  const [appendContent, setAppendContent] = useState("");
  const [submittingAppend, setSubmittingAppend] = useState(false);
  const [togglingPin, setTogglingPin] = useState(false);
  const [deletingAppendId, setDeletingAppendId] = useState<number | null>(null);
  const [editing, setEditing] = useState(initialEditing);
  const appendFormRef = useRef<HTMLDivElement | null>(null);
  const editFormRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showAppendForm) return;
    requestAnimationFrame(() => {
      appendFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [showAppendForm]);

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [editing]);

  const loadPost = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await postsApi.get(postId);
      if (res.success && res.data) {
        setPost(res.data.post);
      } else {
        setError(res.error?.message || "加载动态失败");
      }
    } catch {
      setError("网络错误，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  const handleAddAppend = async () => {
    if (!appendContent.trim()) return;

    setSubmittingAppend(true);
    try {
      const res = await postsApi.addAppend(postId, appendContent.trim());
      if (res.success) {
        setAppendContent("");
        setShowAppendForm(false);
        loadPost(); // Reload to show new append
      } else {
        setError(res.error?.message || "添加补充失败");
      }
    } catch {
      setError("网络错误，请稍后重试。");
    } finally {
      setSubmittingAppend(false);
    }
  };

  const handleDeletePost = async () => {
    if (!confirm("确定要删除这条动态吗？此操作不可撤销。")) return;

    try {
      const res = await postsApi.delete(postId);
      if (res.success) {
        onDelete?.();
      } else {
        setError(res.error?.message || "删除动态失败");
      }
    } catch {
      setError("网络错误，请稍后重试。");
    }
  };

  const handleTogglePin = async () => {
    if (!post) return;

    setTogglingPin(true);
    try {
      const res = await postsApi.setPinned(post.id, !(post.pinned === 1));
      if (res.success) {
        onPinChange?.();
        loadPost();
      } else {
        setError(res.error?.message || "更新置顶状态失败");
      }
    } catch {
      setError("网络错误，请稍后重试。");
    } finally {
      setTogglingPin(false);
    }
  };

  const handleDeleteAppend = async (appendId: number) => {
    setDeletingAppendId(appendId);
    try {
      const res = await postsApi.deleteAppend(postId, appendId);
      if (res.success) {
        loadPost();
      } else {
        setError(res.error?.message || "删除补充失败");
      }
    } catch {
      setError("网络错误，请稍后重试。");
    } finally {
      setDeletingAppendId(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="bg-white p-8 text-center">
        <p className="mb-4 text-red-600">{error || "未找到这条动态"}</p>
        <button
          onClick={loadPost}
          className="primary-action-button px-4 py-2"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 pb-4 pt-[calc(1rem+var(--safe-top))] sm:py-4">
        <h2 className="text-lg font-semibold">动态详情</h2>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className="p-6"
        style={{ paddingBottom: "calc(1.5rem + var(--safe-bottom))" }}
      >
        {editing ? (
          <div ref={editFormRef}>
            <PostForm
              editPost={post}
              onCancel={() => setEditing(false)}
              onSuccess={() => {
                setEditing(false);
                loadPost();
                onUpdate?.();
              }}
            />
          </div>
        ) : (
          <PostCard post={post} onTagClick={onTagClick} detail />
        )}

        {!editing && post.appends.length > 0 && (
          <div className="mt-6 space-y-2">
            {post.appends.map((append) => (
              <div key={append.id} className="rounded-[5px] bg-gray-50 p-4 text-sm">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-soft">
                  <span>{formatBeijingDateTime(append.created_at)}</span>
                  {canManage && (
                    <button
                      onClick={() => handleDeleteAppend(append.id)}
                      disabled={deletingAppendId === append.id}
                      className="text-[#ef8f72] hover:underline disabled:opacity-50"
                    >
                      删除补充
                    </button>
                  )}
                </div>
                <div className="text-[#1f2430]"><MarkdownContent content={append.content} onTagClick={onTagClick} /></div>
              </div>
            ))}
          </div>
        )}

        {/* Append form */}
        {!editing && canManage && showAppendForm && (
          <div ref={appendFormRef} className="mt-6 rounded-[5px] bg-gray-50 p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">添加补充</h4>
            <textarea
              autoFocus
              value={appendContent}
              onChange={(e) => setAppendContent(e.target.value)}
              onFocus={(e) => {
                const el = e.currentTarget;
                setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
              }}
              placeholder="补充内容..."
              rows={3}
              className="field-input w-full resize-none px-3 py-2"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setShowAppendForm(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleAddAppend}
                disabled={!appendContent.trim() || submittingAppend}
                className="primary-action-button px-4 py-1.5 text-sm"
              >
                {submittingAppend ? "发布中..." : "发布补充"}
              </button>
            </div>
          </div>
        )}

        {!editing && canManage && !showAppendForm && (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <button
              onClick={() => setShowAppendForm(true)}
              className="font-medium text-[#5d8fd6] hover:underline"
            >
              添加补充
            </button>
            <button
              onClick={() => setEditing(true)}
              className="font-medium text-[#5d8fd6] hover:underline"
            >
              编辑
            </button>
            <button
              onClick={handleTogglePin}
              disabled={togglingPin}
              className="font-medium text-[#68c7b8] hover:underline disabled:opacity-50"
            >
              {post.pinned === 1 ? "取消置顶" : "置顶"}
            </button>
            <button
              onClick={handleDeletePost}
              className="font-medium text-[#ef8f72] hover:underline"
            >
              删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
