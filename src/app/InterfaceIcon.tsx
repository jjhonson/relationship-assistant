import type { ReactNode } from "react";

export type InterfaceIconName = "chat" | "search" | "chevron" | "close" | "layers" | "alert" | "mail" | "phone" | "link" | "cake" | "work" | "pin" | "heart" | "family" | "history" | "compass" | "sparkles" | "calendar" | "arrow";

const paths: Record<InterfaceIconName, ReactNode> = {
  chat: <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-4A7.5 7.5 0 1 1 20 11.5Z"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  layers: <><rect x="5" y="5" width="12" height="12" rx="2"/><path d="M19 8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  phone: <path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a13 13 0 0 1-6-6l2-2-2-5Z"/>,
  link: <><path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/></>,
  cake: <><path d="M3 16h18v5H3zM5 16v-4h14v4M8 12V8m4 4V8m4 4V8M8 5h.01m4 0h.01m4 0h.01"/></>,
  work: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 13h18M10 13v2h4v-2"/></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  heart: <path d="M20.8 8.6c0 4.4-8.8 9.9-8.8 9.9S3.2 13 3.2 8.6a4.5 4.5 0 0 1 8.8-1.2 4.5 4.5 0 0 1 8.8 1.2Z"/>,
  family: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/></>,
  history: <><path d="M4 11a8 8 0 1 1 2.4 6M4 5v6h6m2-4v5l3 2"/></>,
  compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/></>,
  sparkles: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 1 2.5L22 19l-2 1-1 2-1-2-2-1 2-1.5L19 15ZM4 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18"/></>,
  arrow: <path d="M7 17 17 7M7 7h10v10"/>,
};
export default function InterfaceIcon({ name, className = "size-4" }: { name: InterfaceIconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" className={className}>{paths[name]}</svg>;
}
