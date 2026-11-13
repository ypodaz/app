import type { ReactNode } from 'react';
import { AssistantButton } from '../components/Assistant';
import { SegmentedLinks } from './ui';
import { EmbedCtx } from './embed';

/** Köhnə (v1) səhifəni yeni qabığın içində göstərir: öz yan paneli/alt menyusu gizlənir (AdminShell → useEmbedded),
 *  məzmun tünd «köhnə görünüş» konteynerində qalır. Yeni ekran hazır olanda route cədvəlində bu sətir əvəzlənir. */
export function Legacy({ children, tabs }: { children: ReactNode; tabs?: ReactNode }) {
  return (
    <EmbedCtx.Provider value>
      {tabs}
      <div className="legacy">{children}</div>
      <AssistantButton />
    </EmbedCtx.Provider>
  );
}

/** Bölmə daxilində keçid (segmented): yalnız mövcud köhnə ekranlar. */
export const CEKILIS_TABS = [
  { value: 'teqvim', label: 'Təqvim', href: '#/cekilisler/teqvim' },
  { value: 'siyahi', label: 'Siyahı', href: '#/cekilisler/siyahi' },
  { value: 'montaj', label: 'Montaj', href: '#/cekilisler/montaj' },
];
export const INSAN_TABS = [
  { value: 'lead', label: 'Lead', href: '#/insanlar?tab=lead' },
  { value: 'musteri', label: 'Müştəri', href: '#/insanlar?tab=musteri' },
  { value: 'hamisi', label: 'Hamısı', href: '#/insanlar?tab=hamisi' },
];
export const SectionTabs = ({ options, value, label }: { options: typeof CEKILIS_TABS; value: string; label: string }) => (
  <div style={{ display: 'flex' }}><SegmentedLinks options={options} value={value} label={label} /></div>
);
