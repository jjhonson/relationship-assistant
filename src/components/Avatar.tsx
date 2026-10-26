import { initials } from "@/lib/format";

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "h-16 w-16 text-xl" : "h-12 w-12 text-base";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700 ${dims}`}
    >
      {initials(name)}
    </span>
  );
}
