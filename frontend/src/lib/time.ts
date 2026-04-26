const BEIJING_TIME_ZONE = "Asia/Shanghai";

function parseUtcDate(value: string) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value);
  }

  return new Date(value.replace(" ", "T") + "Z");
}

export function formatBeijingDateTime(value: string) {
  const date = parseUtcDate(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBeijingTime(value: string) {
  const date = parseUtcDate(value);
  if (Number.isNaN(date.getTime())) return "--:--";

  return date.toLocaleTimeString("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getBeijingNowParts() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
  };
}
