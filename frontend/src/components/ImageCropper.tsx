"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { Area } from "react-easy-crop";

type AspectOption = { label: string; value: number | undefined };

const ASPECT_OPTIONS: AspectOption[] = [
  { label: "自由", value: undefined },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
];

interface ImageCropperProps {
  file: File;
  index: number;
  total: number;
  onApply: (cropped: File) => void;
  onSkip: () => void;
  onCancelAll: () => void;
}

async function getCroppedImage(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  outputType: string,
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = imageSrc;
  });

  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const rotatedWidth = image.width * cos + image.height * sin;
  const rotatedHeight = image.width * sin + image.height * cos;

  // 1) draw the rotated image into a temp canvas at full size
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = rotatedWidth;
  rotatedCanvas.height = rotatedHeight;
  const rctx = rotatedCanvas.getContext("2d");
  if (!rctx) throw new Error("无法创建 canvas 上下文");
  rctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  rctx.rotate(radians);
  rctx.drawImage(image, -image.width / 2, -image.height / 2);

  // 2) crop the rotated canvas
  const out = document.createElement("canvas");
  out.width = pixelCrop.width;
  out.height = pixelCrop.height;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("无法创建输出 canvas 上下文");
  octx.drawImage(
    rotatedCanvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("生成裁剪图片失败"));
      },
      outputType,
      0.92,
    );
  });
}

export function ImageCropper({ file, index, total, onApply, onSkip, onCancelAll }: ImageCropperProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCroppedAreaPixels(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const resetCropState = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAspect(undefined);
  };

  const handleApply = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setProcessing(true);
    try {
      const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels, rotation, outputType);
      const ext = outputType === "image/png" ? ".png" : ".jpg";
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const cropped = new File([blob], `${baseName}-cropped${ext}`, { type: outputType });
      onApply(cropped);
    } catch (err) {
      console.error("裁剪失败", err);
      alert("裁剪失败，请重试");
    } finally {
      setProcessing(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: "calc(0.75rem + var(--safe-top))" }}>
        <button
          type="button"
          onClick={onCancelAll}
          className="text-sm font-medium text-white/80 hover:text-white"
        >
          取消全部
        </button>
        <span className="text-sm text-white/80">
          裁剪 {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm font-medium text-white/80 hover:text-white"
        >
          跳过这张
        </button>
      </div>

      {/* Cropper */}
      <div className="relative flex-1 bg-black">
        {imageSrc && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            objectFit="contain"
          />
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3 bg-[#1a1a1a] px-4 pb-4 pt-3 text-white" style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}>
        {/* Aspect */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-white/60">比例</span>
          {ASPECT_OPTIONS.map((opt) => {
            const active = (opt.value ?? null) === (aspect ?? null);
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setAspect(opt.value)}
                className={`rounded-full px-3 py-1 text-xs ${
                  active
                    ? "bg-[#64b7ea] text-white"
                    : "bg-white/10 text-white/80 hover:bg-white/20"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Rotation */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">旋转</span>
          <button
            type="button"
            onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
            aria-label="向左旋转 90 度"
          >
            ↺ 左转
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
            aria-label="向右旋转 90 度"
          >
            ↻ 右转
          </button>
          <span className="text-xs text-white/60">{rotation}°</span>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">缩放</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[#64b7ea]"
          />
          <span className="w-10 text-right text-xs text-white/60">{zoom.toFixed(2)}x</span>
        </div>

        {/* Apply */}
        <button
          type="button"
          onClick={resetCropState}
          className="w-full rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20"
        >
          恢复原状
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={processing || !croppedAreaPixels}
          className="w-full rounded-full bg-[#64b7ea] px-4 py-3 text-sm font-semibold text-white hover:bg-[#53a7da] disabled:opacity-50"
        >
          {processing ? "处理中..." : `应用裁剪${total > 1 ? `（继续下一张）` : ""}`}
        </button>
      </div>
    </div>,
    document.body,
  );
}
