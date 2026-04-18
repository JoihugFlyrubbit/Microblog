"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PostDetail } from "./PostDetail";

interface PostDetailModalProps {
  postId: number;
  onClose: () => void;
  onDelete?: () => void;
  onPinChange?: () => void;
  onTagClick?: (tag: string) => void;
  canManage?: boolean;
}

export function PostDetailModal({
  postId,
  onClose,
  onDelete,
  onPinChange,
  onTagClick,
  canManage = false,
}: PostDetailModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-white"
      style={{ minHeight: "100dvh" }}
    >
      <div className="mx-auto w-full max-w-3xl">
        <PostDetail
          postId={postId}
          onClose={onClose}
          onDelete={onDelete}
          onPinChange={onPinChange}
          onTagClick={onTagClick}
          canManage={canManage}
        />
      </div>
    </div>,
    document.body,
  );
}
