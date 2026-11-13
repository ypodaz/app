import { go } from '../../../router';
import { NewShootDialog } from './NewShoot';
import { Ferq } from './Ferq';
import { Montaj } from './Montaj';
import { Siyahi } from './Siyahi';
import { Teqvim } from './Teqvim';
import type { PanelDialog } from './ShootPanel';
import './cekilis.css';

/** Çəkilişlər marşrutu: /cekilisler/*, köhnə /calendar, /materials və /shoots/*. */
export function CekilisRoute({ path, query }: { path: string[]; query: URLSearchParams }) {
  const [a, b, c] = path;
  const num = Number(b);
  if (a === 'materials' || (a === 'cekilisler' && b === 'montaj')) return <Montaj />;
  if (a === 'cekilisler' && b === 'siyahi') return <Siyahi />;
  if (a === 'cekilisler' && b === 'teqvim-ferqi') return <Ferq />;
  const back = () => go('cekilisler/teqvim');
  if ((a === 'cekilisler' && b === 'yeni') || (a === 'shoots' && b === 'new')) {
    return <><Teqvim query={new URLSearchParams()} /><NewShootDialog query={query} onClose={back} /></>;
  }
  if (a === 'shoots' && num) {
    // Köhnə yollar: yeni təqvimdə yan panel / dialoq kimi açılır
    const initial: PanelDialog = c === 'edit' || c === 'close' || c === 'cancel' ? c : null;
    const q = new URLSearchParams({ gorunus: 'hefte', secili: String(num) });
    return <Teqvim key={`${num}${c ?? ''}`} query={q} initial={initial} onInitialDone={() => go(`cekilisler/teqvim?secili=${num}`)} />;
  }
  return <Teqvim query={query} />;
}
