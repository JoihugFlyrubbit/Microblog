"use client";

interface BrandMarkProps {
  compact?: boolean;
  subtitle?: string;
  variant?: "brand" | "home";
}

const brandSegments = [
  { text: "J", className: "text-[#f4c65d]" },
  { text: "o", className: "text-[#ef8f72]" },
  { text: "i", className: "text-[#64b7ea]" },
  { text: " 的 ", className: "text-[#1f2430] text-[0.72em] align-[0.18em]" },
  { text: "M", className: "text-[#68c7b8]" },
  { text: "i", className: "text-[#f4c65d]" },
  { text: "c", className: "text-[#ef8f72]" },
  { text: "r", className: "text-[#64b7ea]" },
  { text: "o", className: "text-[#68c7b8]" },
  { text: "b", className: "text-[#f4c65d]" },
  { text: "l", className: "text-[#ef8f72]" },
  { text: "o", className: "text-[#64b7ea]" },
  { text: "g", className: "text-[#68c7b8]" },
];

const homeSegments = [
  { text: "H", className: "text-[#f4c65d]" },
  { text: "o", className: "text-[#ef8f72]" },
  { text: "m", className: "text-[#64b7ea]" },
  { text: "e", className: "text-[#68c7b8]" },
];

export function BrandMark({ compact = false, subtitle, variant = "brand" }: BrandMarkProps) {
  const segments = variant === "home" ? homeSegments : brandSegments;

  return (
    <div className={compact ? "flex items-center gap-3" : "space-y-5"}>
      <div
        className={
          compact
            ? "text-[1.2rem] font-bold leading-none tracking-[-0.04em] sm:text-[1.4rem]"
            : "text-[clamp(3.5rem,12vw,7rem)] font-bold leading-[0.92] tracking-[-0.08em]"
        }
      >
        {segments.map((segment) => (
          <span key={`${segment.text}-${segment.className}`} className={segment.className}>
            {segment.text}
          </span>
        ))}
        {!compact && variant === "home" && <span className="text-[#ef8f72]">.</span>}
      </div>
      {subtitle && (
        <p
          className={
            compact
              ? "hidden text-sm text-soft sm:block"
              : "max-w-xl text-base leading-7 text-soft sm:text-lg"
          }
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
