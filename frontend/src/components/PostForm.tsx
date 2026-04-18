"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { postsApi, Media, PostWithRelations, TagWithCount, tagsApi } from "@/lib/api";
import { MediaUploader } from "./MediaUploader";

interface PostFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  editPost?: PostWithRelations;
}

export function PostForm({ onSuccess, onCancel, editPost }: PostFormProps) {
  const isEditing = !!editPost;
  const [content, setContent] = useState(editPost?.content ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    editPost?.visibility ?? "public"
  );
  const [media, setMedia] = useState<Media[]>(editPost?.media ?? []);
  const [existingTags, setExistingTags] = useState<TagWithCount[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedTags = Array.from(
    new Set(
      (content.match(/#([\w\u4e00-\u9fa5]+)/g) || []).map((tag) =>
        tag.slice(1).toLowerCase()
      )
    )
  );

  useEffect(() => {
    const loadTags = async () => {
      try {
        const res = await tagsApi.list({ includePrivate: true });
        if (res.success && res.data) {
          setExistingTags(res.data.tags);
        }
      } catch (fetchError) {
        console.error("Failed to load tag suggestions:", fetchError);
      }
    };

    loadTags();
  }, []);

  const insertTag = (tag: string) => {
    const normalizedTag = tag.replace(/^#/, "");
    const tagToken = `#${normalizedTag}`;

    setContent((prev) => {
      if (prev.includes(tagToken)) return prev;
      const trimmed = prev.trimEnd();
      if (!trimmed) return tagToken;
      return `${trimmed} ${tagToken}`;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedContent = content.trim();
    if (!trimmedContent && media.length === 0) {
      setError("请填写内容或上传图片/视频");
      return;
    }

    if (trimmedContent.length > 10000) {
      setError("内容不能超过 10000 字");
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        content: trimmedContent,
        visibility,
        tagNames: detectedTags,
        mediaIds: media.map((m) => String(m.id)),
      };
      const res = isEditing
        ? await postsApi.update(editPost!.id, payload)
        : await postsApi.create(payload);

      if (res.success) {
        if (!isEditing) {
          setContent("");
          setMedia([]);
        }
        onSuccess?.();
      } else {
        setError(res.error?.message || (isEditing ? "保存失败" : "发布失败"));
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMediaUpload = (newMedia: Media) => {
    setMedia((prev) => [...prev, newMedia]);
  };

  const handleRemoveMedia = (mediaId: number) => {
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
  };

  const charCount = content.length;

  return (
    <form onSubmit={handleSubmit} className="surface-card-soft p-6 sm:p-8">
      {error && (
        <div className="mb-5 rounded-[10px] bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Content textarea */}
      <div className="mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="分享你的想法..."
          rows={6}
          maxLength={10000}
          className="field-input w-full resize-none px-5 py-4"
          disabled={submitting}
        />
        <div className="flex justify-end mt-1">
          <span
            className={`text-sm ${
              charCount > 10000 ? "text-red-500" : "text-gray-400"
            }`}
          >
            {charCount} / 10000
          </span>
        </div>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-[#1f2430]">
          标签
        </label>
        <p className="text-sm text-soft">
          直接在正文里输入 `#标签`，系统会自动识别。
        </p>
        {existingTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {existingTags.map((tag, index) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => insertTag(tag.name)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  index % 4 === 0
                    ? "bg-[#fff3ef] text-[#ef8f72]"
                    : index % 4 === 1
                      ? "bg-[#eef7ff] text-[#64b7ea]"
                      : index % 4 === 2
                        ? "bg-[#eefaf7] text-[#68c7b8]"
                        : "bg-[#fff9ea] text-[#f1b94e]"
                }`}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Media upload */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-[#1f2430]">
          媒体
        </label>

        {/* Media preview */}
        {media.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {media.map((m) => (
              <div key={m.id} className="relative aspect-square group">
                {m.type === "image" ? (
                  <Image
                    src={m.url}
                    alt=""
                    fill
                    sizes="(min-width: 768px) 160px, 33vw"
                    className="h-full w-full rounded-none object-cover"
                    unoptimized
                  />
                ) : (
                  <video
                    src={m.url}
                    className="h-full w-full rounded-none object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveMedia(m.id)}
                  disabled={submitting}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-sm"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <MediaUploader
          onUploadComplete={handleMediaUpload}
          onUploadError={setError}
          maxFiles={9 - media.length}
        />
      </div>

      {/* Visibility toggle */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[#1f2430]">
          可见性
        </label>
        <div className="flex gap-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white/82 px-4 py-2">
            <input
              type="radio"
              name="visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              disabled={submitting}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-[#1f2430]">公开</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white/82 px-4 py-2">
            <input
              type="radio"
              name="visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
              disabled={submitting}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-[#1f2430]">私密</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-soft hover:text-[#1f2430]"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || (!content.trim() && media.length === 0)}
          className="primary-action-button flex items-center gap-2 px-6 py-3"
        >
          {submitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {isEditing ? "保存中..." : "发布中..."}
            </>
          ) : (
            isEditing ? "保存" : "发布"
          )}
        </button>
      </div>
    </form>
  );
}
