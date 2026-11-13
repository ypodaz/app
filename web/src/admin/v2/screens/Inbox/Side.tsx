import { serviceLabel, stageName, type ConvMode, type ConvOpen, type Stage } from '../../../components/crm';
import { Chip } from '../../ui';
import { phoneLabel } from './logic';

const STEPS: Stage[] = ['yeni', 'maraqlanir', 'tarix', 'beh'];
const SOURCE: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', reklam: 'Instagram reklamı', diger: 'Digər' };

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
      {/* TODO [API] İnsan kartına keçid: kontaktdan müştəri (Client) id-si cavabda yoxdur, ad link deyil. */}
      <div>
        <h2 className="ibp__name">{name}</h2>
        <p className="ibp__phone mono">{phoneLabel(data.contact.phone)}</p>
      </div>
      {lead ? <Steps stage={lead.stage} /> : <p className="ibp__none">Hələ lead yoxdur · bot müştəri xidmət və tarix yazanda yaradır</p>}
      {/* TODO [API] «Mərhələni bot təyin etdi · 19:02», «Bot xülasəsi» və «Gedişat» hadisələri: serverdə hadisə siyahısı endpoint-i yoxdur. */}
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
        {/* TODO [API] keşbek: /inbox/{id} cavabında müştəri keşbeki yoxdur («ilk çəkiliş 40%» göstərilmir). */}
        <div><dt>Kanal</dt><dd>WhatsApp</dd></div>
        {data.contact.excluded && <div><dt>Bot</dt><dd>Dostdur · yazmır</dd></div>}
      </dl>
      {/* TODO [API] «Çəkilişlər» siyahısı: söhbətdən çəkilişlərə (client_id) bağ yoxdur. */}
    </aside>
  );
}
