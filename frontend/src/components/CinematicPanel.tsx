import React from 'react';
import { ArenaCornerBrackets } from './ArenaHUD';

interface CinematicPanelProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'red' | 'blue' | 'emerald' | 'amber';
  showBrackets?: boolean;
}

export const CinematicPanel: React.FC<CinematicPanelProps> = ({
  children,
  className = '',
  glowColor = 'red',
  showBrackets = true,
}) => {
  const glowStyles =
    glowColor === 'emerald'
      ? 'border-emerald-500/50 shadow-[0_0_35px_rgba(16,185,129,0.2)]'
      : glowColor === 'blue'
      ? 'border-blue-500/50 shadow-[0_0_35px_rgba(37,99,235,0.2)]'
      : glowColor === 'amber'
      ? 'border-amber-500/50 shadow-[0_0_35px_rgba(245,158,11,0.2)]'
      : 'border-neutral-800/90 shadow-[0_0_35px_rgba(220,38,38,0.15)]';

  return (
    <div
      className={`relative p-6 sm:p-8 rounded-2xl bg-neutral-950/85 border backdrop-blur-md overflow-hidden transition-all duration-300 ${glowStyles} ${className}`}
    >
      {showBrackets && <ArenaCornerBrackets />}
      {children}
    </div>
  );
};
