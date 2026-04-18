"use client";

import { useCallback, useEffect, useState } from "react";
import { Post, postsApi } from "@/lib/api";
import { PostCard } from "./PostCard";

interface PinnedPostsProps {
  visibility: "public" | "all";
  date?: string;
  tag?: string;
  refreshKey?: number;
  onPostClick?: (post: Post) => void;
  onTagClick?: (tag: string) => void;
}

export function PinnedPosts({ visibility, date, tag, refreshKey = 0, onPostClick, onTagClick }: PinnedPostsProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPinnedPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await postsApi.list({
        visibility,
        pinned: true,
        page: 1,
        date,
        tag,
      });

      if (res.success && res.data) {
        setPosts(res.data.posts);
      }
    } catch (error) {
      console.error("Failed to load pinned posts:", error);
    } finally {
      setLoading(false);
    }
  }, [visibility, date, tag]);

  useEffect(() => {
    loadPinnedPosts();
  }, [loadPinnedPosts, refreshKey]);

  if (loading || posts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard
          key={`pinned-${post.id}`}
          post={post}
          compact
          wideMedia
          carousel
          onClick={() => onPostClick?.(post)}
          onTagClick={onTagClick}
        />
      ))}
    </div>
  );
}
