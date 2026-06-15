import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

export interface BlobAvatarProps {
  emotion: string;
  speaking: boolean;
  listening: boolean;
  speechPulse: number;
}

/**
 * A beautiful, animated gradient blob that replaces the traditional face.
 * It pulses and changes shape based on whether the agent is speaking or listening.
 */
export function BlobAvatar({ speaking, listening, speechPulse }: BlobAvatarProps) {
  const [pulseScale, setPulseScale] = useState(1);
  const lastPulse = useRef(0);

  // React to speechPulse by briefly expanding the blob
  useEffect(() => {
    if (speechPulse > lastPulse.current) {
      lastPulse.current = speechPulse;
      setPulseScale(1.15);
      const timeout = setTimeout(() => setPulseScale(1), 150);
      return () => clearTimeout(timeout);
    }
  }, [speechPulse]);

  return (
    <div className="relative w-48 h-48 flex items-center justify-center">
      <svg
        viewBox="0 0 200 200"
        className={clsx(
          "w-full h-full transition-transform duration-150 ease-out",
          listening && "animate-pulse"
        )}
        style={{ transform: `scale(${pulseScale})` }}
      >
        <defs>
          <linearGradient id="blob-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: "#8B5CF6", stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: "#EC4899", stopOpacity: 1 }} />
          </linearGradient>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>

        <g filter="url(#goo)">
          <path
            fill="url(#blob-grad)"
            className={clsx(
              "transition-all duration-700 ease-in-out",
              speaking ? "animate-blob-fast" : "animate-blob-slow"
            )}
            d="M44.7,-76.4C58.8,-69.2,71.8,-59.1,79.6,-46.2C87.4,-33.3,90,-16.7,89.1,-0.5C88.2,15.6,83.8,31.2,75.1,44.3C66.4,57.4,53.4,68,39.1,75.3C24.8,82.6,9.2,86.6,-5.8,86.6C-20.8,86.6,-35.1,82.6,-47.9,74.7C-60.7,66.8,-71.9,55.1,-79.3,41.4C-86.7,27.7,-90.3,12.1,-88.4,-3.1C-86.4,-18.2,-78.9,-33,-68.6,-45C-58.3,-57.1,-45.1,-66.4,-31.2,-73.8C-17.3,-81.1,-2.7,-86.5,11.1,-85.1C24.9,-83.7,30.6,-83.6,44.7,-76.4Z"
            transform="translate(100 100)"
          >
            {!speaking && !listening && (
               <animate
               attributeName="d"
               dur="10s"
               repeatCount="indefinite"
               values="
                 M44.7,-76.4C58.8,-69.2,71.8,-59.1,79.6,-46.2C87.4,-33.3,90,-16.7,89.1,-0.5C88.2,15.6,83.8,31.2,75.1,44.3C66.4,57.4,53.4,68,39.1,75.3C24.8,82.6,9.2,86.6,-5.8,86.6C-20.8,86.6,-35.1,82.6,-47.9,74.7C-60.7,66.8,-71.9,55.1,-79.3,41.4C-86.7,27.7,-90.3,12.1,-88.4,-3.1C-86.4,-18.2,-78.9,-33,-68.6,-45C-58.3,-57.1,-45.1,-66.4,-31.2,-73.8C-17.3,-81.1,-2.7,-86.5,11.1,-85.1C24.9,-83.7,30.6,-83.6,44.7,-76.4Z;
                 M52.3,-71.4C66.5,-63.1,76.5,-47.7,81.3,-31.3C86.1,-14.9,85.7,2.5,80.5,17.9C75.3,33.3,65.3,46.7,52.8,57.6C40.3,68.5,25.3,76.9,9.4,78.2C-6.5,79.5,-23.3,73.7,-38.2,65.4C-53,57.1,-65.9,46.3,-74.6,32.7C-83.3,19.1,-87.8,2.7,-85.4,-12.7C-83,-28.1,-73.7,-42.5,-61.1,-52.1C-48.5,-61.7,-32.6,-66.5,-17.7,-71.9C-2.8,-77.3,11.1,-83.3,26.5,-82.7C41.9,-82.1,38.1,-79.7,52.3,-71.4Z;
                 M44.7,-76.4C58.8,-69.2,71.8,-59.1,79.6,-46.2C87.4,-33.3,90,-16.7,89.1,-0.5C88.2,15.6,83.8,31.2,75.1,44.3C66.4,57.4,53.4,68,39.1,75.3C24.8,82.6,9.2,86.6,-5.8,86.6C-20.8,86.6,-35.1,82.6,-47.9,74.7C-60.7,66.8,-71.9,55.1,-79.3,41.4C-86.7,27.7,-90.3,12.1,-88.4,-3.1C-86.4,-18.2,-78.9,-33,-68.6,-45C-58.3,-57.1,-45.1,-66.4,-31.2,-73.8C-17.3,-81.1,-2.7,-86.5,11.1,-85.1C24.9,-83.7,30.6,-83.6,44.7,-76.4Z
               "
               />
            )}
          </path>
        </g>
      </svg>
    </div>
  );
}
