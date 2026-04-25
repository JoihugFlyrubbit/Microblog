"use client";

import { useState, useRef } from "react";
import { uploadApi, Media } from "@/lib/api";

interface MediaUploaderProps {
  onUploadComplete?: (media: Media) => void;
  onUploadError?: (error: string) => void;
  maxFiles?: number;
  acceptedTypes?: string;
}

export function MediaUploader({
  onUploadComplete,
  onUploadError,
  maxFiles = 9,
  acceptedTypes = "image/*,video/*",
}: MediaUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileType = (file: File): "image" | "video" => {
    return file.type.startsWith("video/") ? "video" : "image";
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = URL.createObjectURL(file);
    });
  };

  const compressImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith("image/")) {
      return file;
    }

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 2048;
        const maxHeight = 2048;
        let { width, height } = image;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }

            if (blob.size >= file.size) {
              resolve(file);
              return;
            }

            const compressed = new File(
              [blob],
              file.name.replace(/\.[^.]+$/, "") + ".jpg",
              { type: "image/jpeg" }
            );
            resolve(compressed);
          },
          "image/jpeg",
          0.82
        );
      };
      image.onerror = () => resolve(file);
      image.src = URL.createObjectURL(file);
    });
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const uploadFile = async (inputFile: File) => {
    const file = await compressImage(inputFile);
    const fileId = `${file.name}-${Date.now()}`;
    setUploadProgress((prev) => ({ ...prev, [fileId]: 0 }));

    try {
      // Step 1: Get presigned URL
      const presignedRes = await uploadApi.getPresignedUrl({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      });

      if (!presignedRes.success || !presignedRes.data) {
        throw new Error(presignedRes.error?.message || "获取上传地址失败");
      }

      const { url, mode } = presignedRes.data;

      let mediaId: number;
      let mediaUrl: string;

      if (mode === 'local') {
        // Local mode: convert to base64 and upload directly
        setUploadProgress((prev) => ({ ...prev, [fileId]: 30 }));

        const base64Data = await fileToBase64(file);
        const type = getFileType(file);
        let dimensions = { width: 0, height: 0 };

        if (type === "image") {
          dimensions = await getImageDimensions(file);
        }

        setUploadProgress((prev) => ({ ...prev, [fileId]: 60 }));

        // Upload to local endpoint
        const localRes = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data: base64Data,
            type,
            size: file.size,
            width: dimensions.width,
            height: dimensions.height,
          }),
        });

        if (!localRes.ok) {
          const errorData = await localRes.json().catch(() => ({}));
          throw new Error(errorData.error?.message || '本地上传失败');
        }

        const localData = await localRes.json();
        if (!localData.success) {
          throw new Error(localData.error?.message || '本地上传失败');
        }

        mediaId = localData.data.mediaId;
        mediaUrl = localData.data.url;
        setUploadProgress((prev) => ({ ...prev, [fileId]: 100 }));
      } else {
        // COS mode: upload to COS
        const { authorization, headers } = presignedRes.data;

        const xhr = new XMLHttpRequest();

        await new Promise<void>((resolve, reject) => {
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);
              setUploadProgress((prev) => ({ ...prev, [fileId]: progress }));
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`上传失败：${xhr.statusText}`));
            }
          });

          xhr.addEventListener("error", () => reject(new Error("上传失败")));

          xhr.open("PUT", url);
          xhr.setRequestHeader("Content-Type", headers["Content-Type"]);
          xhr.setRequestHeader("Authorization", authorization);
          xhr.send(file);
        });

        // Step 2: Confirm upload
        const type = getFileType(file);
        let dimensions = { width: 0, height: 0 };

        if (type === "image") {
          dimensions = await getImageDimensions(file);
        }

        const confirmRes = await uploadApi.confirmUpload({
          key: presignedRes.data.key,
          url,
          type,
          size: file.size,
          width: dimensions.width || undefined,
          height: dimensions.height || undefined,
        });

        if (!confirmRes.success || !confirmRes.data) {
          throw new Error(confirmRes.error?.message || "保存媒体记录失败");
        }

        mediaId = confirmRes.data.mediaId;
        mediaUrl = confirmRes.data.url;
      }

      const media: Media = {
        id: mediaId,
        post_id: 0,
        type: getFileType(file),
        url: mediaUrl,
        size: file.size,
        width: undefined,
        height: undefined,
        created_at: new Date().toISOString(),
      };

      onUploadComplete?.(media);
      return media;
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传失败";
      onUploadError?.(message);
      throw error;
    } finally {
      setUploadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[fileId];
        return newProgress;
      });
    }
  };

  const uploadAll = async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        await uploadFile(file);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > maxFiles) {
      onUploadError?.(`最多只能上传 ${maxFiles} 个文件`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    await uploadAll(Array.from(files));
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes}
        multiple={maxFiles > 1}
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="field-input w-full border-2 border-dashed py-3 text-[#64b7ea] hover:border-[#64b7ea] hover:text-[#53a7da] disabled:opacity-50"
      >
        {uploading ? (
          <span>上传中...</span>
        ) : (
          <>
            <span className="text-2xl mr-2">📷</span>
            <span>点击添加图片或视频</span>
          </>
        )}
      </button>

      {Object.entries(uploadProgress).map(([fileId, progress]) => (
        <div key={fileId} className="field-input p-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="truncate text-soft">{fileId.split("-")[0]}</span>
            <span className="text-[#64b7ea]">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#e8f3fb]">
            <div
              className="h-full bg-[#64b7ea] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ))}

    </div>
  );
}
