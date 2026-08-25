import { Mascot } from './Mascot';

export function Logo({ size = 28 }: { size?: number }) {
  return <Mascot pose="face" size={size} className="brand-mascot" alt="" />;
}

export function LegacyLogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden focusable="false">
      <rect width="40" height="40" rx="12" fill="url(#cb-grad)" />
      <path d="M12 24c0-4 3-7 7-7 3 0 5.5 1.8 6.5 4.3 2.6.3 4.5 2.4 4.5 5 0 2.8-2.3 5-5.1 5H13.6c-2.5 0-4.6-2-4.6-4.5 0-1.7 1-3.2 2.4-4z" fill="#fff" fillOpacity=".95" />
      <circle cx="16.5" cy="22.5" r="1.6" fill="#7C3AED" />
      <circle cx="21.5" cy="22.5" r="1.6" fill="#7C3AED" />
      <defs>
        <linearGradient id="cb-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
