"use client";

import { useState, useEffect, useCallback } from "react";
import { tagsApi, CalendarDate } from "@/lib/api";
import { getBeijingNowParts } from "@/lib/time";

const datePalette = [
  { idle: "text-[#ef8f72] bg-[#fff3ef]", active: "bg-[#ef8f72] text-white" },
  { idle: "text-[#64b7ea] bg-[#eef7ff]", active: "bg-[#64b7ea] text-white" },
  { idle: "text-[#68c7b8] bg-[#eefaf7]", active: "bg-[#68c7b8] text-white" },
  { idle: "text-[#f1b94e] bg-[#fff9ea]", active: "bg-[#f1b94e] text-white" },
];

interface CalendarProps {
  onDateSelect?: (date?: string) => void;
  selectedDate?: string;
  includePrivate?: boolean;
  refreshKey?: number;
}

export function Calendar({ onDateSelect, selectedDate, includePrivate = false, refreshKey = 0 }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    const now = getBeijingNowParts();
    return new Date(now.year, now.month, 1);
  });
  const [datesWithPosts, setDatesWithPosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const loadDates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tagsApi.getCalendarDates({
        year: String(year),
        month: String(month + 1),
        includePrivate,
      });

      if (res.success && res.data) {
        const dateMap: Record<string, number> = {};
        res.data.dates.forEach((d: CalendarDate) => {
          dateMap[d.date] = d.count;
        });
        setDatesWithPosts(dateMap);
      }
    } catch (error) {
      console.error("Failed to load calendar dates:", error);
    } finally {
      setLoading(false);
    }
  }, [includePrivate, year, month]);

  useEffect(() => {
    loadDates();
  }, [loadDates, refreshKey]);

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const formatDate = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const emptyDays = Array.from({ length: firstDay }, (_, i) => i);

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const isToday = (day: number) => {
    const today = getBeijingNowParts();
    return (
      day === today.day &&
      month === today.month &&
      year === today.year
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-[#1f2430] hover:bg-white"
          disabled={loading}
        >
          ←
        </button>
        <h3 className="text-center text-lg font-semibold tracking-[-0.03em] text-[#1f2430]">
          {year}年{month + 1}月
        </h3>
        <button
          onClick={nextMonth}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-[#1f2430] hover:bg-white"
          disabled={loading}
        >
          →
        </button>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div key={day} className="py-1 text-center text-sm text-soft">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {emptyDays.map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}
        {days.map((day) => {
          const dateStr = formatDate(day);
          const hasPosts = datesWithPosts[dateStr];
          const isSelected = selectedDate === dateStr;
          const today = isToday(day);
          const palette = datePalette[(day - 1) % datePalette.length];

          return (
            <button
              key={day}
              onClick={() => onDateSelect?.(isSelected ? undefined : dateStr)}
              className={`
                relative aspect-square rounded-full text-sm transition-colors
                ${isSelected ? `${palette.active} shadow-[0_14px_28px_rgba(93,101,118,0.18)]` : hasPosts ? palette.idle : "bg-white/75 text-[#1f2430] hover:bg-white"}
                ${today && !isSelected ? "font-medium ring-1 ring-[#1f2430]/10" : ""}
              `}
            >
              <span className="flex h-full flex-col items-center justify-center leading-none">
                <span>{day}</span>
                {hasPosts && (
                  <span
                    className={`text-[10px] ${
                      isSelected ? "text-blue-100" : "text-soft"
                    }`}
                    style={{ marginTop: "1px" }}
                  >
                    {hasPosts}条
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
