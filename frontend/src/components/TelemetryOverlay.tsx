import React from 'react';

interface StageBadgeProps {
  stageNumber: string;
  stageTitle: string;
  dotColor?: 'red' | 'amber' | 'emerald';
  pulse?: boolean;
}

export const StageBadge: React.FC<StageBadgeProps> = ({
  stageNumber,
  stageTitle,
  dotColor = 'red',
  pulse = true,
}) => {
  const dotColorClass =
    dotColor === 'emerald'
      ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
      : dotColor === 'amber'
      ? 'bg-amber-500'
      : 'bg-red-600';

  return (
    <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-300 shadow-lg backdrop-blur-md">
      <span className={`w-2.5 h-2.5 rounded-full ${dotColorClass} ${pulse ? 'animate-pulse' : ''}`} />
      <span>Stage {stageNumber} // {stageTitle}</span>
    </div>
  );
};

export const CornerBrackets: React.FC = () => {
  return (
    <>
      <span className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-red-600/70 pointer-events-none" />
      <span className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-red-600/70 pointer-events-none" />
      <span className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-red-600/70 pointer-events-none" />
      <span className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-red-600/70 pointer-events-none" />
    </>
  );
};
