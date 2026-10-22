import { createRoot } from 'react-dom/client';
import { PlayerAvatar } from '../../PlayerAvatar';
import './style.css';

const root = createRoot(document.getElementById('root') as HTMLElement);
Object.assign(window, {
  renderAvatar(skin?: string) {
    root.render(<PlayerAvatar name="Player" label="Player" {...(skin ? { skin } : {})} />);
  },
});
root.render(<PlayerAvatar name="Player" label="Player" />);
