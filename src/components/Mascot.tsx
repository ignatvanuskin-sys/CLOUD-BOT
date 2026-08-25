import type { CSSProperties, HTMLAttributes } from 'react';

export type MascotPose = 'neutral' | 'open' | 'thinking' | 'surprised' | 'happy' | 'face';

const assets: Record<MascotPose, string> = {
  neutral: '/mascot/mascot-neutral.png',
  open: '/mascot/mascot-open.png',
  thinking: '/mascot/mascot-thinking.png',
  surprised: '/mascot/mascot-surprised.png',
  happy: '/mascot/mascot-happy.png',
  face: '/mascot/mascot-face.png',
};

export function Mascot({ pose = 'neutral', size = 112, alt = '', className, style, ...props }: { pose?: MascotPose; size?: number | string; alt?: string; className?: string; style?: CSSProperties } & Omit<HTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'style'>) {
  return <img src={assets[pose]} width={typeof size === 'number' ? size : undefined} height={typeof size === 'number' ? size : undefined} alt={alt} aria-hidden={alt ? undefined : true} className={className} style={{ '--mascot-size': typeof size === 'number' ? `${size}px` : size, ...style } as CSSProperties} {...props} />;
}
