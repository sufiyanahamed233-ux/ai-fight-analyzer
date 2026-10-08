import { useEffect, useRef, useState } from 'react';

/**
 * DasaraIntroScreen
 *
 * Timeline:
 *   0.0s → 2.0s  — Pure black screen, nothing visible
 *   2.0s → 6.0s  — Dasara image appears immediately (no fade, no zoom, no sweep)
 *   6.0s         — Transition to Welcome screen
 */

interface Props {
  onComplete: () => void;
}

type Phase = 'black' | 'reveal';

export function DasaraIntroScreen({ onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('black');
  const completedRef = useRef(false);

  useEffect(() => {
    // 2.0s: Image appears instantly
    const t1 = setTimeout(() => setPhase('reveal'), 2000);
    
    // 6.0s: Transition to welcome screen
    const t2 = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, 6000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onComplete]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: '#000',
        overflow: 'hidden',
      }}
    >
      {/* ── Main image wrapper ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: phase === 'black' ? 0 : 1,
          transition: 'opacity 2s ease-in-out',
        }}
      >
        {/* The Dasara Exhibition Image (no zoom/particles/sweep, just fade) */}
        <img
          src="/dasara-exhibition.jpg"
          alt="Welcome to Dasara Exhibition"
          style={{
            width: '100vw',
            height: '100vh',
            objectFit: 'cover',
            objectPosition: 'center',
            display: 'block',
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
