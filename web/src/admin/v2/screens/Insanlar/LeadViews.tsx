import { useMemo, useState, type DragEvent } from 'react';
import { lostLabel, serviceLabel } from '../../../components/crm';
import { bakuParts, bakuToday } from '../../../format';
import { go } from '../../../router';
import { Avatar, Button, Chip, EmptyState, type ChipTone } from '../../ui';
import { OPEN_STAGES, STAGE_LABEL, agoShort, isConverted, leadName, phoneShown, remindDue, remindText, type Lead, type Stage } from './data';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

export const stageTone = (s: Stage): ChipTone => (s === 'beh' ? 'deposit' : s === 'itirildi' ? 'cancel' : s === 'tesdiq' || s === 'geldi' ? 'done' : 'neutral');
export const StageChip = ({ stage }: { stage: Stage }) => <Chip tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Chip>;

const cardHref = (l: Lead) => `#/insanlar/lead-${l.id}`;
const serviceLine = (l: Lead) => [serviceLabel(l.service), l.preferred_date].filter(Boolean).join(' · ') || 'Xidmət bəlli deyil';

/** Xatırlatmalı (vaxtı gələn) lead-lər yuxarıda, sonra son aktivliyə görə (server sırası). */
export const byUrgency = (a: Lead, b: Lead) => Number(remindDue(b)) - Number(remindDue(a));

// ---------- Cədvəl ----------
export function LeadTable({ leads, online, onRemind, onLost }: { leads: Lead[]; online: boolean; onRemind: (l: Lead) => void; onLost: (l: Lead) => void }) {
  const sorted = useMemo(() => [...leads].sort(byUrgency), [leads]);
  return (
    <div className="ins-tbl" role="table" aria-label="Lead-lər">
      <div className="ins-tr ins-tr--h ins-tr--lead" role="row">
        <span role="columnheader">İnsan</span><span role="columnheader">Mərhələ</span><span role="columnheader">Nə istəyir</span><span role="columnheader">Xatırlatma</span><span role="columnheader" className="ins-r">Son əlaqə</span><span role="columnheader" className="ins-r">Əməl</span>
      </div>
      {sorted.map((l) => (
        <div key={l.id} className="ins-tr ins-tr--lead" role="row">
          <span className="ins-who" role="cell">
            <Avatar name={leadName(l)} tone={remindDue(l) ? 'deposit' : 'neutral'} />
            <span className="ins-who__t"><a className="ins-name" href={cardHref(l)}>{leadName(l)}</a><span className="ins-sub mono">{phoneShown(l.phone) || 'telefon yoxdur'}</span></span>
          </span>
          <span role="cell" className="ins-stg"><StageChip stage={l.stage} /></span>
          <span role="cell" className="ins-ask">{serviceLine(l)}{l.stage === 'itirildi' && lostLabel(l) && <em>Səbəb: {lostLabel(l)}</em>}</span>
          <span role="cell" className="ins-rem">{l.remind_at ? <><b className={remindDue(l) ? 'ins-due' : ''}>🔔 <span className="mono">{remindText(l)}</span></b>{l.remind_note && <em>{l.remind_note}</em>}</> : <span className="ins-dim">—</span>}</span>
          <span role="cell" className="ins-r mono ins-dim2">{agoShort(l.updated_at)}</span>
          <span role="cell" className="ins-act">
            {!isConverted(l) && <Button size="row" disabled={!online} onClick={() => onRemind(l)}>{l.remind_at ? 'Xatırlatma' : 'Xatırlat'}</Button>}
            {!isConverted(l) && l.stage !== 'itirildi' && <Button size="row" variant="text" disabled={!online} onClick={() => onLost(l)}>İtirildi</Button>}
            {l.conversation_id && <Button size="row" variant="text" onClick={() => go(`inbox/${l.conversation_id}`)}>Söhbət</Button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Lövhə ----------
type Col = { key: string; label: string; stage?: Stage; leads: Lead[]; drop: boolean; foot?: string; note?: string };
const SHOW = 8;

export function Board({ leads, online, onMove }: { leads: Lead[]; online: boolean; onMove: (l: Lead, to: Stage) => void }) {
  const [drag, setDrag] = useState<Lead | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const month = bakuToday().slice(0, 7);
  const cols: Col[] = useMemo(() => {
    const sorted = [...leads].sort(byUrgency);
    const conv = sorted.filter((l) => isConverted(l) && bakuParts(l.updated_at).date.startsWith(month));
    return [
      ...OPEN_STAGES.map((s): Col => ({ key: s, label: STAGE_LABEL[s], stage: s, leads: sorted.filter((l) => l.stage === s), drop: true })),
      // TODO [API] «Çəkilişə çevrildi» sütunu çevrilmə tarixini və çəkiliş vaxtını tələb edir; lead yalnız updated_at verir (cari ay üzrə təxmini süzgəc).
      { key: 'conv', label: 'Çəkilişə çevrildi', leads: conv, drop: false, note: 'nəticədir, mərhələ deyil', foot: `${MONTHS[Number(month.slice(5)) - 1]} ${conv.length}` },
      { key: 'itirildi', label: 'İtirildi', stage: 'itirildi', leads: sorted.filter((l) => l.stage === 'itirildi'), drop: true },
    ];
  }, [leads, month]);

  const onDrop = (c: Col, e: DragEvent) => {
    e.preventDefault();
    const l = drag;
    setDrag(null); setOver(null);
    if (!l || !c.stage || !c.drop || l.stage === c.stage) return;
    // TODO [Sual] 99 E «Lövhə»: Beh sütununa sürükləmək «Yeni çəkiliş» dialoqunu açmalıdır; o dialoq Çəkilişlər sənədinin işidir, indi yalnız mərhələ dəyişir.
    onMove(l, c.stage);
  };

  return (
    <div className="ins-board" aria-label="Lead lövhəsi">
      {cols.map((c) => {
        const open = all[c.key];
        const list = open ? c.leads : c.leads.slice(0, SHOW);
        const blocked = drag && !c.drop;
        return (
          <section key={c.key} className={`ins-col${c.key === 'conv' ? ' ins-col--result' : ''}${over === c.key && c.drop && drag?.stage !== c.stage ? ' ins-col--over' : ''}${blocked && over === c.key ? ' ins-col--no' : ''}`} aria-label={c.label}
            onDragOver={(e) => { if (!drag) return; setOver(c.key); if (c.drop) e.preventDefault(); else e.dataTransfer.dropEffect = 'none'; }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === c.key ? null : o)); }}
            onDrop={(e) => onDrop(c, e)}>
            <h2 className="ins-col__h">{c.label}<span className="mono">{c.leads.length}</span></h2>
            {c.note && <p className="ins-col__n">{c.note}</p>}
            <div className="ins-col__b">
              {list.map((l) => <BoardCard key={l.id} l={l} col={c.key} draggable={online && !isConverted(l)} onDragStart={() => setDrag(l)} onDragEnd={() => { setDrag(null); setOver(null); }} />)}
              {!c.leads.length && <p className="ins-col__e">{c.key === 'conv' ? 'Bu ay hələ yoxdur' : `${c.label} mərhələsində lead yoxdur`}</p>}
              {c.leads.length > SHOW && !open && <Button size="row" variant="text" onClick={() => setAll((a) => ({ ...a, [c.key]: true }))}>+ {c.leads.length - SHOW} daha</Button>}
            </div>
            {c.foot && <p className="ins-col__f mono">{c.foot}</p>}
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ l, col, draggable, onDragStart, onDragEnd }: { l: Lead; col: string; draggable: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <article className={`ins-bc${draggable ? ' ins-bc--drag' : ''}${remindDue(l) ? ' ins-bc--due' : ''}`} draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(l.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }} onDragEnd={onDragEnd}>
      <div className="ins-bc__r1"><a className="ins-name" href={cardHref(l)} draggable={false} title={leadName(l)}>{leadName(l)}</a><span className="mono ins-dim2">{agoShort(l.updated_at)}</span></div>
      <div className="ins-bc__r2">{serviceLine(l)}</div>
      {l.remind_at && <div className={`ins-bc__r3${remindDue(l) ? ' ins-due' : ''}`}>🔔 <span className="mono">{remindText(l)}</span>{l.remind_note ? ` · ${l.remind_note}` : ''}</div>}
      {col === 'itirildi' && lostLabel(l) && <div className="ins-bc__r3">Səbəb: {lostLabel(l)}</div>}
      {/* TODO [API] Kartın «növbəti addım» sətri və bot vəziyyəti («bot aparır», «bot ötürdü: səbəb») lead cavabında yoxdur (21-lovhe.md kart sətir 4–5). */}
    </article>
  );
}

export function LeadEmpty({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return filtered
    ? <EmptyState title="Bu süzgəcə uyğun lead yoxdur" reason="Axtarışı və ya süzgəci dəyişin." action={<Button size="sm" onClick={onReset}>Süzgəci təmizlə</Button>} />
    : <EmptyState title="Lead yoxdur · bot müştərinin sorğusunu görəndə burada görünəcək" reason="Yeni kontaktı «Yeni kontakt» ilə də əlavə edə bilərsiniz." />;
}
