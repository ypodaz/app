import { PageHeader } from '../../shell/PageHeader';
import { Card, ErrorBox, LoadingRows, Switch, V2Icon, useOnline } from '../../ui';
import { KapsoMeter, useBotSettings } from './Bot';
import './tenzimleme.css';

/** Mobil Bot (34-bot.md, route /m/bot): yalnız AI açarı və say. Qalan ayarlar kompüterdə. */
export function MBot() {
  const { s, act, save } = useBotSettings();
  const online = useOnline();
  const d = s.data;
  return (
    <>
      <a className="mbot-back" href="#/m/daha"><V2Icon name="back" size={18} />Daha çox</a>
      <PageHeader title="Bot" newShoot={false} more={false} />
      <div className="tz">
        {s.err && !d && <ErrorBox title="Ayarlar yüklənmədi" detail={s.err} onRetry={s.reload} />}
        {!d && !s.err && <LoadingRows rows={2} />}
        {act.err && <ErrorBox title="Saxlanmadı" detail={act.err} />}
        {d && (
          <>
            <div className="mbot-card">
              <span><b>Bot {d.bot_enabled ? 'açıqdır' : 'bağlıdır'}</b><span className="tz-sub" style={{ display: 'block' }}>{d.bot_enabled ? '24/7 cavab hazırlayır' : 'Cavab hazırlanmır'}</span></span>
              <Switch ai checked={d.bot_enabled} disabled={act.busy || !online} label="Bot açıq" onChange={(v) => save({ bot_enabled: v })} />
            </div>
            <Card><KapsoMeter d={d} /></Card>
            <p className="tz-muted">Qaydalar, bilik bazası və hazır cavablar kompüterdə açılır.</p>
          </>
        )}
      </div>
    </>
  );
}
