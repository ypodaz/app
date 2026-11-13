import type { ReactNode } from 'react';
import { PageHeader } from '../../shell/PageHeader';
import { SegmentedLinks } from '../../ui';
import { Ic } from './bits';

const TABS = [
  { value: 'teqvim', label: 'Təqvim', href: '#/cekilisler/teqvim' },
  { value: 'siyahi', label: 'Siyahı', href: '#/cekilisler/siyahi' },
  { value: 'montaj', label: 'Montaj', href: '#/cekilisler/montaj' },
];

/** Çəkilişlər bölməsinin ortaq başlığı: başlıq + Təqvim/Siyahı/Montaj + alətlər + Apple sinxron sətri. */
export function CekHead({ tab, sub, tools, sync }: { tab: 'teqvim' | 'siyahi' | 'montaj'; sub?: ReactNode; tools?: ReactNode; sync?: number | null }) {
  return (
    <>
      <PageHeader title="Çəkilişlər" sub={sub} newShoot="secondary" />
      <div className="ck-bar">
        <SegmentedLinks options={TABS} value={tab} label="Çəkilişlər" />
        {tools && <div className="ck-bar__tools">{tools}</div>}
      </div>
      {tab !== 'montaj' && (
        <p className="ck-sync">
          <Ic name="sync" size={14} />
          {/* TODO [API] «Təqvimdə N · app-da N · N uyğunlaşmayıb» sayları: Apple ilə müqayisə endpoint-i yoxdur (yalnız Shoot.source_note var). */}
          <span>Apple təqvimi ilə sinxron{sync ? <> · <b className="mono">{sync}</b> çəkiliş təqvimdən gəlib</> : null}</span>
          <a href="#/cekilisler/teqvim-ferqi">Təqvim fərqi →</a>
        </p>
      )}
    </>
  );
}
