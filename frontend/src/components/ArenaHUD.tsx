import React from 'react';

interface ArenaHeaderProps {
  stageNumber: string;
  stageTitle: string;
  isLive?: boolean;
}

export const ArenaHeader: React.FC<ArenaHeaderProps> = ({
  stageNumber,
  stageTitle,
  isLive = false,
}) => {
  return (
    <div className="flex items-center justify-between px-6 py-3.5 bg-neutral-950/90 border-b border-neutral-800/80 backdrop-blur-md">
      {/* Stage Badge */}
      <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-neutral-300 shadow-inner">
        <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
        <span>Stage {stageNumber} // {stageTitle}</span>
      </div>

      {/* Camera Live Indicator */}
      {isLive && (
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded bg-red-950/70 border border-red-700/60 text-[10px] sm:text-xs font-mono uppercase tracking-widest text-red-400 shadow-[0_0_15px_rgba(220,38,38,0.3)]">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
          CAMERA&nbsp;1&nbsp;•&nbsp;LIVE
        </div>
      )}
    </div>
  );
};

export const ArenaCornerBrackets: React.FC = () => {
  return (
    <>
      <span className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-red-600/70 pointer-events-none" />
      <span className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-red-600/70 pointer-events-none" />
      <span className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-red-600/70 pointer-events-none" />
      <span className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-red-600/70 pointer-events-none" />
    </>
  );
};
