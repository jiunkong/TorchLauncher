import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const MenuIcon = () => (
  <Svg>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const CollapseIcon = () => (
  <Svg>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13l11-6.5z" />
  </Svg>
);
export const PlayFilledIcon = () => (
  <Svg>
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </Svg>
);
export const ModsIcon = () => (
  <Svg>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
    <path d="M4 8l8 4 8-4M12 12v8" />
  </Svg>
);
export const SettingsIcon = () => (
  <Svg>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Svg>
);
export const LogsIcon = () => (
  <Svg>
    <path d="M6 4h12v16H6z" />
    <path d="M9 9h6M9 13h6M9 17h4" />
  </Svg>
);
export const LogoutIcon = () => (
  <Svg>
    <path d="M9 5H5v14h4M16 8l4 4-4 4M20 12H9" />
  </Svg>
);
export const MicrosoftIcon = () => (
  <Svg>
    <rect x="4" y="4" width="7" height="7" fill="currentColor" stroke="none" />
    <rect x="13" y="4" width="7" height="7" fill="currentColor" stroke="none" />
    <rect x="4" y="13" width="7" height="7" fill="currentColor" stroke="none" />
    <rect x="13" y="13" width="7" height="7" fill="currentColor" stroke="none" />
  </Svg>
);
export const StopIcon = () => (
  <Svg>
    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const RetryIcon = () => (
  <Svg>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
  </Svg>
);
