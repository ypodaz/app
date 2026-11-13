// Inbox-a məxsus ikonlar (ui/Icon.tsx-ə toxunmuram). Ortaq ola bilər: send, clock, moon, chevDown, play, pause, bot.
const P = {
  chevDown: <path d="m6 9 6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  forward: <path d="M5 12h14M13 6l6 6-6 6" />,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4M9 14h.01M15 14h.01" /></>,
} as const;

export type IbIconName = keyof typeof P;

export function IbIcon({ name, size = 16, sw = 1.5 }: { name: IbIconName; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}
