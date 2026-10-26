const MS_PER_DAY = 86_400_000;

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY));
}

export function describeGap(days: number): string {
  if (days < 1) return "Today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} month${m === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
