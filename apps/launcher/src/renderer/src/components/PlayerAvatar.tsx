import { type CSSProperties, type SyntheticEvent, useState } from 'react';
import './PlayerAvatar.css';

const PREFIX = 'data:image/png;base64,';

/** A second boundary: the renderer never assigns remote or arbitrary data URLs to an image. */
export function avatarSkinHeight(skin: string | undefined): 32 | 64 | null {
  if (!skin?.startsWith(PREFIX) || skin.length > 87_406) return null;
  const encoded = skin.slice(PREFIX.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z\d+/]+={0,2}$/.test(encoded)) return null;
  try {
    const bytes = atob(encoded);
    if (bytes.length < 33 || bytes.length > 65_536 || btoa(bytes) !== encoded) return null;
    if (bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(8, 16) !== '\0\0\0\rIHDR')
      return null;
    if (bytes.slice(16, 20) !== '\0\0\0@') return null;
    const height = bytes.charCodeAt(23);
    return bytes.slice(20, 23) === '\0\0\0' && (height === 32 || height === 64) ? height : null;
  } catch {
    return null;
  }
}

export interface PlayerAvatarProps {
  name: string | null;
  label: string;
  skin?: string;
}

function SkinLayers({ skin, height }: { skin: string; height: 32 | 64 }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const loaded = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setStatus(image.naturalWidth === 64 && image.naturalHeight === height ? 'ready' : 'failed');
  };
  if (status === 'failed') return null;
  return (
    <span
      className="player-avatar-skin"
      data-ready={status === 'ready'}
      aria-hidden="true"
      style={{ '--skin-height': height } as CSSProperties}
    >
      <img
        className="player-avatar-face"
        src={skin}
        alt=""
        draggable={false}
        onLoad={loaded}
        onError={() => setStatus('failed')}
      />
      <img
        className="player-avatar-hat"
        src={skin}
        alt=""
        draggable={false}
        onError={() => setStatus('failed')}
      />
    </span>
  );
}

export function PlayerAvatar({ name, label, skin }: PlayerAvatarProps) {
  const height = avatarSkinHeight(skin);
  return (
    <span
      className={`avatar player-avatar${name ? '' : ' empty'}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="player-avatar-fallback">
        {name ? ([...name][0] ?? '?').toUpperCase() : '?'}
      </span>
      {skin && height && <SkinLayers key={skin} skin={skin} height={height} />}
    </span>
  );
}
