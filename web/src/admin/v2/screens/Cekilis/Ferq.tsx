import { addDays, bakuParts, bakuToday, dateShort, range, timeRange } from '../../../format';
import { useLoad } from '../../../ctx';
import { go } from '../../../router';
import type { Shoot } from '../../../types';
import { EmptyState, ErrorBox, LoadingRows } from '../../ui';
import { PageHeader } from '../../shell/PageHeader';
import { SRC_LABEL, personName, srcOf, svcText } from './bits';

/** Çəkilişlər › Təqvim fərqi (11). Apple ilə müqayisə endpoint-i yoxdur: yalnız source_note-a görə qruplaşdırma. */
export function Ferq() {
  const today = bakuToday();
  const q = useLoad<Shoot[]>(`/shoots?${range(addDays(today, -400), addDays(today, 120))}`);
  const all = q.data ?? [];
  const apple = all.filter((s) => srcOf(s) === 'apple').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const arx = all.filter((s) => srcOf(s) === 'arxiv').sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  // TODO [API] «Yalnız Apple-da / Yalnız app-da / Vaxt fərqlidir» cərgələri və «Apple-dan götür», «Appa yaz», «Fərqi bağla» düymələri: Apple müqayisə endpoint-i yoxdur.
  return (
    <>
      <PageHeader title="Təqvim fərqi" sub="Apple təqvimindən gələn və arxivə köçürülən çəkilişlər" />
      <p className="ck-sync"><a href="#/cekilisler/teqvim">← Təqvimə qayıt</a></p>
      {q.err ? <ErrorBox title="Yüklənmədi" detail={q.err} onRetry={q.reload} /> : !q.data ? <LoadingRows rows={6} /> : (
        <>
          <Group title={SRC_LABEL.apple} list={apple} empty="Apple təqvimindən gələn çəkiliş yoxdur." />
          <Group title="Arxiv (köçürülmüş keçmiş çəkilişlər)" list={arx.slice(0, 60)} empty="Arxiv çəkilişi yoxdur." note={arx.length > 60 ? `Son 60 göstərilir, cəmi ${arx.length}.` : undefined} />
        </>
      )}
    </>
  );
}

function Group({ title, list, empty, note }: { title: string; list: Shoot[]; empty: string; note?: string }) {
  return (
    <section className="ck-grp">
      <h2 className="ck-panel__h">{title} <span className="mono">{list.length}</span></h2>
      {!list.length ? <EmptyState title={empty} /> : (
        <ul className="ck-rows">
          {list.map((s) => {
            const p = bakuParts(s.starts_at);
            return (
              <li key={s.id}>
                <button type="button" className="ck-row ck-row--3" onClick={() => go(`cekilisler/teqvim?tarix=${p.date}&gorunus=gun&secili=${s.id}`)}>
                  <span className="ck-row__d mono">{dateShort(p.date)}<small>{timeRange(s.starts_at, s.duration_min)}</small></span>
                  <span className="ck-row__m"><b>{personName(s)}</b><span className="ck-sub">{svcText(s)}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {note && <p className="ck-sub">{note}</p>}
    </section>
  );
}
