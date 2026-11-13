import { serviceLabel, stageName, type ConvMode, type ConvOpen, type LeadEventRow, type Stage } from '../../../components/crm';
import { bakuParts } from '../../../format';
import { Chip } from '../../ui';
import { phoneLabel } from './logic';

const STEPS: Stage[] = ['yeni', 'maraqlanir', 'tarix', 'beh'];
const SOURCE: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', reklam: 'Instagram reklamı', diger: 'Digər' };

const SHOOT_ST: Record<string, string> = { confirmed: 'Təsdiqli', completed: 'Bitib', cancelled: 'Ləğv', no_show: 'Gəlmədi' };
const TAG: Record<string, string> = { podcast: 'Podkast', reels: 'Reels', other: 'Çəkiliş' };
const dm = (iso: string) => { const p = bakuParts(iso); return `${p.date.slice(8, 10)}.${p.date.slice(5, 7)} ${p.time}`; };

/** «Gedişat» sətri (02 #55): lead hadisəsi insan dilində. */
function eventText(e: LeadEventRow): string {
  const d = e.data ?? {};
  const by = d.by === 'admin' ? 'siz' : 'bot';
  switch (e.kind) {
    case 'created': return `Lead yarandı · ${d.via === 'inbox' ? 'Inbox-dan əlavə edildi' : d.source === 'reklam' ? 'reklamdan' : d.source === 'instagram' ? 'Instagram-dan' : 'WhatsApp-dan'}`;
    case 'stage': return `Mərhələ: ${stageName(String(d.from ?? ''))} → ${stageName(String(d.to ?? ''))} (${by})`;
    case 'confirmed': return 'Çəkiliş yaradıldı';
    case 'remind': return 'Xatırlatma qoyuldu';
    case 'linked': return 'Söhbət lead-ə bağlandı';
    case 'update': return 'Bot məlumatı yenilədi';
    case 'admin_edit': return 'Siz məlumatı dəyişdiniz';
    default: return e.kind;
  }
}

function Steps({ stage }: { stage: Stage }) {
  const done = stage === 'tesdiq' || stage === 'geldi';
  const idx = STEPS.indexOf(stage);
  const cur = done ? STEPS.length - 1 : idx;
  return (
    <div>
      <ol className="ibp__steps" role="img" aria-label={done ? 'Çəkilişə çevrildi' : idx >= 0 ? `Mərhələ: ${stageName(stage)}, ${idx + 1}-ci addım ${STEPS.length}-dən` : `Mərhələ: ${stageName(stage)}`}>
        {STEPS.map((s, i) => (
          <li key={s} className={`ibp__step${i < cur || done ? ' is-done' : ''}${i === cur && !done && stage !== 'itirildi' ? ' is-cur' : ''}`}><i /><span>{stageName(s)}</span></li>
        ))}
      </ol>
      {done && <p className="ibp__note">Çəkilişə çevrildi</p>}
      {stage === 'itirildi' && <p className="ibp__note"><Chip tone="cancel">İtirildi</Chip></p>}
    </div>
  );
}

/** İnsan paneli (02 #47–#55). Yalnız `/inbox/{id}` cavabındakı sahələr: kontakt + lead. */
export function Side({ data, mode }: { data: ConvOpen; mode: ConvMode }) {
  const lead = data.lead;
  const name = (data.contact.name || '').trim() || (lead?.name ?? '').trim() || phoneLabel(data.contact.phone);
  const bits = lead ? [serviceLabel(lead.service), lead.people ? `${lead.people} nəfər` : '', lead.cameras ? `${lead.cameras} kamera` : '', lead.preferred_date ?? ''].filter(Boolean) : [];
  return (
    <aside className="ib__side ibp" aria-label="İnsan">
      <div>
        <h2 className="ibp__name">{data.client ? <a href={`#/insanlar/${data.client.id}`}>{name}</a> : name}</h2>
        <p className="ibp__phone mono">{phoneLabel(data.contact.phone)}</p>
      </div>
      {lead ? <Steps stage={lead.stage} /> : <p className="ibp__none">Hələ lead yoxdur · bot müştəri xidmət və tarix yazanda yaradır</p>}
      <div className={`ibp__next${mode === 'bot' ? ' ibp__next--none' : ''}`}>
        <span className="ibp__k">Növbəti addım</span>
        {mode === 'bot'
          ? <><b>Yoxdur — bot aparır</b><span>Ötürmə şərti yaransa növbənizə düşəcək</span></>
          : lead?.shoot_id
            ? <><b>Çəkiliş yaradılıb</b><a href={`#/shoots/${lead.shoot_id}`}>Çəkilişə bax</a></>
            : bits.length ? <><b>{bits.join(' · ')}</b><span>Lead məlumatından</span></> : <><b>Cavab yazın</b><span>Müştəri sizi gözləyir</span></>}
        {/* TODO [API] «Çəkiliş yarat» (lead → çəkiliş dialoqu, 14-yeni-cekilis.md) və «Növbəti addım» mətni (Sabah 15:00-ı saxla): serverdən hazır təklif gəlmir. */}
      </div>
      <dl className="ibp__facts">
        <h3 className="ibp__h3">Məlumat</h3>
        <div><dt>Mənbə</dt><dd>{SOURCE[lead?.source ?? 'whatsapp'] ?? 'Digər'}</dd></div>
        {data.client
          ? <div><dt>Keşbek</dt><dd className="mono">{data.client.cashback} AZN{data.client.shoots_done === 0 ? ' · ilk çəkiliş 40%' : ''}</dd></div>
          : <div><dt>Müştəri kartı</dt><dd>Yoxdur · ilk çəkilişdə yaranacaq</dd></div>}
        <div><dt>Kanal</dt><dd>WhatsApp</dd></div>
        {data.contact.excluded && <div><dt>Bot</dt><dd>Dostdur · yazmır</dd></div>}
      </dl>
      {!!data.client?.shoots.length && (
        <div className="ibp__facts">
          <h3 className="ibp__h3">Çəkilişlər</h3>
          {data.client.shoots.map((s) => (
            <div key={s.id}><dt><a href={`#/shoots/${s.id}`}>{dm(s.starts_at)}</a></dt><dd>{TAG[s.tag] ?? 'Çəkiliş'} · {SHOOT_ST[s.status] ?? s.status} · <span className="mono">{s.total} AZN</span></dd></div>
          ))}
        </div>
      )}
      {!!data.events?.length && (
        <div className="ibp__facts">
          <h3 className="ibp__h3">Gedişat</h3>
          {data.events.slice(0, 8).map((e, i) => (
            <div key={i}><dt className="mono">{dm(e.at)}</dt><dd>{eventText(e)}</dd></div>
          ))}
        </div>
      )}
    </aside>
  );
}
