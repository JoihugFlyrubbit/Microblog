"use client";

import { useState, useRef } from "react";
import { Media } from "@/lib/api";
import { uploadFileToMedia } from "@/lib/upload";

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

  const uploadFile = async (inputFile: File) => {
    const fileId = `${inputFile.name}-${Date.now()}`;
    setUploadProgress((prev) => ({ ...prev, [fileId]: 0 }));

    try {
      const media = await uploadFileToMedia(inputFile, {
        onProgress: (progress) => setUploadProgress((prev) => ({ ...prev, [fileId]: progress })),
      });

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
