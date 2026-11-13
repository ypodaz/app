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
  // Kanal nişanları (FableInbox: avatarın sağ-alt küncü). YouTube dizaynda yoxdur, eyni üslubda çəkilib.
  wa: <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z" />,
  ig: <><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.5" /></>,
  yt: <><rect x="3" y="6" width="18" height="12" rx="4" /><path d="m10.5 9.5 4 2.5-4 2.5z" /></>,
} as const;

export type IbIconName = keyof typeof P;

export function IbIcon({ name, size = 16, sw = 1.5 }: { name: IbIconName; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}
