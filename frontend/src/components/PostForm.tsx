"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { postsApi, uploadApi, Media, PostWithRelations, TagWithCount, tagsApi } from "@/lib/api";
import { MediaUploader } from "./MediaUploader";
import { ImageCropper } from "./ImageCropper";

async function urlToFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

async function uploadCroppedImage(file: File): Promise<Media> {
  const presigned = await uploadApi.getPresignedUrl({
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });
  if (!presigned.success || !presigned.data) {
    throw new Error(presigned.error?.message || "获取上传地址失败");
  }
  const { url, mode } = presigned.data;
  if (mode !== "local") {
    throw new Error("当前仅支持本地存储模式下重新上传裁剪");
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = URL.createObjectURL(file);
  });
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: dataUrl,
      type: "image",
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
    }),
  });
  if (!res.ok) throw new Error("本地上传失败");
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || "本地上传失败");
  return {
    id: data.data.mediaId,
    post_id: 0,
    type: "image",
    url: data.data.url,
    size: file.size,
    width: undefined,
    height: undefined,
    created_at: new Date().toISOString(),
  };
}

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
  const [cropping, setCropping] = useState<{ mediaId: number; file: File } | null>(null);

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

  const handleStartCrop = async (m: Media) => {
    if (m.type !== "image") return;
    try {
      const file = await urlToFile(m.url, `media-${m.id}.jpg`);
      setCropping({ mediaId: m.id, file });
    } catch {
      setError("无法加载图片用于裁剪");
    }
  };

  const handleCropApply = async (cropped: File) => {
    if (!cropping) return;
    const oldId = cropping.mediaId;
    setCropping(null);
    try {
      const newMedia = await uploadCroppedImage(cropped);
      setMedia((prev) => prev.map((m) => (m.id === oldId ? newMedia : m)));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
    }
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
          autoFocus
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
          }}
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
                {m.type === "image" && (
                  <button
                    type="button"
                    onClick={() => handleStartCrop(m)}
                    disabled={submitting}
                    className="absolute bottom-1 left-1 px-2 h-6 bg-black/55 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                    title="裁剪"
                  >
                    裁剪
                  </button>
                )}
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

      {cropping && (
        <ImageCropper
          file={cropping.file}
          index={0}
          total={1}
          onApply={handleCropApply}
          onSkip={() => setCropping(null)}
          onCancelAll={() => setCropping(null)}
        />
      )}

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
