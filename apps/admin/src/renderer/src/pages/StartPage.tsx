import torchUrl from '../assets/torch.png';
import { FolderIcon, PlusIcon } from '../components/Icons';
import type { StudioController } from '../hooks/useStudio';
import { useStudioLocale } from '../i18n';

export function StartPage({ studio }: { studio: StudioController }) {
  const { t } = useStudioLocale();
  const { busy, run } = studio;
  return (
    <div className="hero" data-testid="start-page">
      <div className="inner">
        <div className="head">
          <img src={torchUrl} alt="" width={72} height={72} />
          <div>
            <h1>
              TORCH<i>LAUNCHER</i>
              <s>STUDIO</s>
            </h1>
            <p>{t('start.lead')}</p>
          </div>
        </div>
        <div className="acts">
          <button
            type="button"
            className="big p"
            disabled={busy}
            data-testid="start-new"
            onClick={() => void run('new')}
          >
            <span className="ic">
              <PlusIcon />
            </span>
            <span>
              <strong>{t('start.new')}</strong>
              <small>{t('start.newHelp')}</small>
            </span>
          </button>
          <button
            type="button"
            className="big"
            disabled={busy}
            data-testid="start-open"
            onClick={() => void run('open')}
          >
            <span className="ic">
              <FolderIcon />
            </span>
            <span>
              <strong>{t('start.open')}</strong>
              <small>{t('start.openHelp')}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
