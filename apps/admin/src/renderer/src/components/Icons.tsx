import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const OverviewIcon = () => (
  <Svg>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Svg>
);
export const ServerIcon = () => (
  <Svg>
    <rect x="4" y="4" width="16" height="6" rx="1.5" />
    <rect x="4" y="14" width="16" height="6" rx="1.5" />
    <path d="M8 7h.01M8 17h.01" />
  </Svg>
);
export const BrandIcon = () => (
  <Svg>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M4 17l5-5 4 4 3-3 4 4" />
  </Svg>
);
export const FolderIcon = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const GamepadIcon = () => (
  <Svg>
    <rect x="3" y="7" width="18" height="11" rx="2" />
    <path d="M7 11h.01M11 11h.01M15 11h.01M8 15h8" />
  </Svg>
);
export const UploadIcon = () => (
  <Svg>
    <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />
  </Svg>
);
export const PackageIcon = () => (
  <Svg>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
    <path d="M4 8l8 4 8-4M12 12v8" />
  </Svg>
);
export const DownloadIcon = () => (
  <Svg>
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);
export const CrossIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const WarnIcon = () => (
  <Svg>
    <path d="M12 4l9 16H3zM12 10v4M12 17v.5" />
  </Svg>
);
export const InfoIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.5" />
  </Svg>
);
export const ArrowIcon = () => (
  <Svg>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const RefreshIcon = () => (
  <Svg>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const UpIcon = () => (
  <Svg>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);
export const DownIcon = () => (
  <Svg>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const FileIcon = () => (
  <Svg>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M10 9h2M10 12h2M10 15h2" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13l11-6.5z" />
  </Svg>
);
export const ModsIcon = PackageIcon;
export const SettingsIcon = () => (
  <Svg>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Svg>
);
