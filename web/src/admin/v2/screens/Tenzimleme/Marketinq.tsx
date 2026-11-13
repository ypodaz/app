import { useEffect, useState } from 'react';
import { useLoad } from '../../../ctx';
import { bakuParts } from '../../../format';
import type { Campaign, CampaignDetail, CampaignKind, Filters } from '../../../types';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, Chip, EmptyState, LinkButton, SegmentedLinks, V2Icon } from '../../ui';
import { Gate, dmy, pct } from './kit';
import './tenzimleme.css';

export const KIND: Record<CampaignKind, string> = { manual: 'Əl ilə', winback: 'Geri qaytarma', cashback: 'Keşbek xatırlatma', birthday: 'Ad günü', review: 'Rəy sorğusu' };
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const SERVICES: Record<string, string> = { podcast: 'Podcast', reels: 'Reels', other: 'Digər', reels_pack: 'Reels paketi', studio_rent: 'Studiya icarəsi' };
const PRESETS: Record<string, string> = { package_candidates: 'Paketə keçid namizədləri', podcast_no_reels: 'Podcast çəkib, Reels yox' };
const when = (iso: string) => `${dmy(bakuParts(iso).date)}, ${bakuParts(iso).time}`;

/** Süzgəc → oxunaqlı çiplər (göndərilmiş kampaniyada yalnız oxunur). */
export function filterLabels(f: Filters): string[] {
  const o: string[] = [];
  if (f.client_ids?.length) o.push(`${f.client_ids.length} seçilmiş müştəri`);
  if (f.preset) o.push(PRESETS[f.preset] ?? f.preset);
  if (f.tag_ids?.length) o.push(`${f.tag_ids.length} teq`);
  if (f.professions?.length) o.push(`İxtisas: ${f.professions.join(', ')}`);
  if (f.services?.length) o.push(`Xidmət: ${f.services.map((s) => SERVICES[s] ?? s).join(', ')}`);
  if (f.sources?.length) o.push(`Mənbə: ${f.sources.join(', ')}`);
  if (f.inactive_days !== undefined) o.push(`${f.inactive_days}+ gün gəlməyib`);
  if (f.has_package !== undefined) o.push(f.has_package ? 'Saat paketi var' : 'Saat paketi yoxdur');
  if (f.min_cashback) o.push(`Keşbek ≥ ${f.min_cashback / 100} AZN`);
  if (f.birthday_month) o.push(`Doğum ayı: ${MONTHS[f.birthday_month - 1]}`);
  if (f.app_joined !== undefined) o.push(f.app_joined ? 'App-a qoşulub' : 'App-a qoşulmayıb');
  if (f.push_on !== undefined) o.push(f.push_on ? 'Bildiriş açıq' : 'Bildiriş bağlı');
  return o;
}

export function MarketinqTabs({ value, campaigns }: { value: 'kampaniya' | 'paylasim'; campaigns?: number }) {
  return (
    <SegmentedLinks label="Marketinq bölmələri" value={value} options={[
      { value: 'kampaniya', label: 'Kampaniyalar', href: '#/tenzimleme/marketinq', count: campaigns },
      { value: 'paylasim', label: 'Paylaşım növbəsi', href: '#/tenzimleme/marketinq/paylasim' },
    ]} />
  );
}

function Detail({ id }: { id: number }) {
  const q = useLoad<CampaignDetail>(`/campaigns/${id}`);
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [id]);
  return (
    <Gate q={q.data && q.data.id !== id ? { ...q, data: null } : q} title="Kampaniya yüklənmədi" rows={3}>
      {(c) => {
        const chips = filterLabels(c.filters);
        const rec = c.recipients;
        const list = all ? c.list : c.list.slice(0, 8);
        return (
          <div className="tz-grid2">
            <Card title="Mesaj" aside={<Chip tone="neutral">{c.kind === 'manual' ? 'Əl ilə' : `Avtomatik · ${KIND[c.kind]}`}</Chip>}>
              <div className="tz-stack">
                <div className="tz-bubble"><b>{c.title}</b>{'\n'}{c.body}</div>
                {c.url && <a className="tz-link" href={c.url} target="_blank" rel="noopener noreferrer">{c.url.replace(/^https?:\/\//, '')}</a>}
                <span className="tz-faint">{when(c.created_at)}{c.created_by ? ` · ${c.created_by}` : ''}</span>
                {/* TODO [API] «Redaktə et», «Cavab verməyənlərə təkrar göndər», «Ləğv et/Sil» (31 §8, §9): kampaniya yalnız göndərilir, dəyişmə/silmə endpoint-i yoxdur. */}
              </div>
            </Card>
            <Card title="Auditoriya və nəticə">
              <div className="tz-stack">
                <span className="tz-muted">Seqment <b className="mono" style={{ color: 'var(--text)' }}>{rec}</b> nəfər</span>
                <div className="tz-pills">{(chips.length ? chips : ['Bütün müştərilər']).map((x) => <span key={x} className="tz-pill">{x}</span>)}</div>
                <div className="tz-tiles">
                  <div className="tz-tile"><span>Göndərildi</span><b className="mono">{rec}</b><i><i style={{ width: '100%' }} /></i></div>
                  <div className="tz-tile"><span>Açdı</span><b className="mono">{c.opened} <small style={{ fontSize: 12, color: 'var(--text-3)' }}>{pct(c.opened, rec)}%</small></b><i><i style={{ width: `${pct(c.opened, rec)}%` }} /></i></div>
                  <div className="tz-tile"><span>14 gündə yazıldı</span><b className="mono">{c.booked_14d} <small style={{ fontSize: 12, color: 'var(--text-3)' }}>{pct(c.booked_14d, rec)}%</small></b><i><i style={{ width: `${pct(c.booked_14d, rec)}%` }} /></i></div>
                </div>
                <span className="tz-muted">Bildirişi {c.push_on} nəfərdə telefona düşüb, hamısı app-da görür.</span>
              </div>
            </Card>
            <div style={{ gridColumn: '1 / -1' }}>
              <Card title={<>Alıcılar<span className="tz-count">{c.list.length}</span></>} flush>
                {list.map((r) => (
                  <a key={r.id} className="row" href={`#/insanlar/${r.id}`} style={{ minHeight: 44, textDecoration: 'none', color: 'var(--text)' }}>
                    <span className="row__hit"><span className="row__main row__title" style={{ fontWeight: 500 }}>{r.full_name}</span><span className="row__meta mono">{r.opened_at ? `açıb · ${when(r.opened_at)}` : 'açmayıb'}</span></span>
                  </a>
                ))}
                {c.list.length > 8 && <div style={{ padding: '8px 12px' }}><Button size="row" variant="text" onClick={() => setAll(!all)}>{all ? 'Yığ' : `Hamısı (${c.list.length})`}</Button></div>}
              </Card>
            </div>
          </div>
        );
      }}
    </Gate>
  );
}

/** Marketinq › Kampaniyalar (31-marketinq.md). Route: /tenzimleme/marketinq, köhnə /campaigns. Real API: app bildirişi kampaniyaları. */
export function Marketinq() {
  const q = useLoad<Campaign[]>('/campaigns');
  const [sel, setSel] = useState<number | null>(null);
  const list = q.data ?? [];
  const cur = sel ?? list[0]?.id ?? null;
  const cols = 'minmax(0,1.7fr) minmax(0,.8fr) minmax(0,.9fr) minmax(0,1.3fr) minmax(0,1.1fr) minmax(0,.9fr)';
  const last = list[0];
  return (
    <>
      <PageHeader title="Marketinq" newShoot={false}
        sub={last ? <>Hansı mesaj rezerv gətirdi · son kampaniya <b>{last.booked_14d}</b> nəfər yazıldı</> : 'Hansı mesaj rezerv gətirdi?'}
        actions={<LinkButton href="#/tenzimleme/marketinq/yeni" variant="primary" size="lg" icon={<V2Icon name="plus" />}>Yeni<span className="tz-hide-sm"> kampaniya</span></LinkButton>} />
      <div className="tz">
        <div className="tz-tabs"><MarketinqTabs value="kampaniya" campaigns={q.data ? list.length : undefined} /></div>
        <Card title={<>App kampaniyaları{q.data && <span className="tz-count">{list.length}</span>}</>}>
          <div className="tz-info"><V2Icon name="alert" size={14} /><span>Yalnız «Təkliflər» açarı açıq müştərilərə gedir · bildiriş app-da və telefonda görünür</span></div>
          {/* TODO [API] Hamısı/Göndərilib/Planlanıb/Qaralama süzgəci (31 §4): kampaniya planlama və qaralama yoxdur, hamısı «Göndərilib». WhatsApp şablon statusu və rezerv sayı da yoxdur (yalnız «14 gündə yazıldı»). */}
          <Gate q={q} title="Kampaniyalar yüklənmədi">
            {() => list.length === 0 ? (
              <EmptyState title="Hələ kampaniya yoxdur" reason="Keşbeki olan və ya bir dəfə çəkilənlərə app bildirişi göndərmək üçün «Yeni kampaniya»-nı basın." action={<LinkButton href="#/tenzimleme/marketinq/yeni">Yeni kampaniya</LinkButton>} />
            ) : (
              <>
                <div className="tz-th" style={{ '--cols': cols } as React.CSSProperties}><span>Ad</span><span>Alıcı</span><span>Göndərildi</span><span>Açdı</span><span>14 gündə yazıldı</span><span>Tarix</span></div>
                {list.map((c) => (
                  <button key={c.id} type="button" className="tz-tr" style={{ '--cols': cols } as React.CSSProperties} aria-pressed={cur === c.id} onClick={() => setSel(c.id)}>
                    <span className="tz-c"><b>{c.title}</b><span className="tz-sub">{c.kind === 'manual' ? 'Əl ilə' : `Avtomatik · ${KIND[c.kind]}`}</span></span>
                    <span className="tz-c mono">{c.recipients}</span>
                    <span className="tz-c"><Chip tone="done">Göndərilib</Chip></span>
                    <span className="tz-c"><div className="tz-prog"><span className="mono">{c.opened} <small className="tz-faint">{pct(c.opened, c.recipients)}%</small></span><i><i style={{ width: `${pct(c.opened, c.recipients)}%` }} /></i></div></span>
                    <span className="tz-c mono">{c.booked_14d}</span>
                    <span className="tz-c mono tz-hide-sm">{dmy(bakuParts(c.created_at).date)}</span>
                  </button>
                ))}
              </>
            )}
          </Gate>
        </Card>
        {cur !== null && <Detail id={cur} />}
      </div>
    </>
  );
}
