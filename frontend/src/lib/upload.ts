"use client";

import { Media, toApiUrl, uploadApi } from "@/lib/api";

export const getFileType = (file: File): "image" | "video" => {
  return file.type.startsWith("video/") ? "video" : "image";
};

export const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: 0, height: 0 });
    };
    img.src = objectUrl;
  });
};

export const compressImage = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
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
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }

          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
              type: "image/jpeg",
            })
          );
        },
        "image/jpeg",
        0.82
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    image.src = objectUrl;
  });
};

interface UploadOptions {
  onProgress?: (progress: number) => void;
  compress?: boolean;
}

export async function uploadFileToMedia(inputFile: File, options: UploadOptions = {}): Promise<Media> {
  const file = options.compress === false ? inputFile : await compressImage(inputFile);
  const type = getFileType(file);
  const dimensions = type === "image" ? await getImageDimensions(file) : { width: 0, height: 0 };

  const presignedRes = await uploadApi.getPresignedUrl({
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });

  if (!presignedRes.success || !presignedRes.data) {
    throw new Error(presignedRes.error?.message || "获取上传地址失败");
  }

  const { url, headers, key, mediaId } = presignedRes.data;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        resolve();
      } else {
        let message = `上传失败：${xhr.status}`;
        try {
          const data = JSON.parse(xhr.responseText);
          message = data.error?.message || message;
        } catch {
          // keep fallback message
        }
        reject(new Error(message));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("上传失败")));
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", headers["Content-Type"]);
    xhr.send(file);
  });

  const confirmRes = await uploadApi.confirmUpload({
    key,
    mediaId,
    url: `r2://${key}`,
    type,
    size: file.size,
    width: dimensions.width || undefined,
    height: dimensions.height || undefined,
  });

  if (!confirmRes.success || !confirmRes.data) {
    throw new Error(confirmRes.error?.message || "保存媒体记录失败");
  }

  return {
    id: confirmRes.data.mediaId,
    post_id: 0,
    type,
    url: toApiUrl(confirmRes.data.url),
    size: file.size,
    width: dimensions.width || undefined,
    height: dimensions.height || undefined,
    created_at: new Date().toISOString(),
  };
}
