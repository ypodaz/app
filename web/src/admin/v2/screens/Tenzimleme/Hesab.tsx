import { useState } from 'react';
import { useAction, useAuth, useLoad } from '../../../ctx';
import type { Dashboard } from '../../../types';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, Chip, Dialog, ErrorBox, LoadingRows, useOnline } from '../../ui';
import { Gate } from './kit';
import type { Settings } from './Bot';
import './tenzimleme.css';

type Info = { channels: { service: string; queue_paused: boolean | null }[] | { error: string } | null };

/** Hesab (35-hesab-giris.md). Route: /tenzimleme/hesab. Köhnə Panel-dəki «App istifadəsi» burada saxlanır. */
export function Hesab() {
  const { signOut, call } = useAuth();
  const online = useOnline();
  const me = useLoad<{ name: string }>('/whoami');
  const dash = useLoad<Dashboard>('/dashboard');
  const bot = useLoad<Settings>('/bot/settings');
  const [out, setOut] = useState(false);
  // Buffer statusu Buffer-ə sorğu atır (gündə limit var): yalnız «Yoxla» düyməsi ilə
  const buf = useAction();
  const [info, setInfo] = useState<Info | null>(null);
  async function check() { const r = await buf.run(() => call<Info>('/social/status')); if (r) setInfo(r); }
  const ch = info?.channels;
  const u = dash.data?.app_usage;

  return (
    <>
      <PageHeader title="Hesab" newShoot={false} sub="Profil, qoşulmalar və giriş" />
      <div className="tz">
        <div className="tz-grid2">
          <Card title="Profil">
            {me.data === null && !me.err ? <LoadingRows rows={2} /> : me.err && !me.data ? <ErrorBox title="Profil yüklənmədi" detail={me.err} onRetry={me.reload} /> : (
              <div className="tz-who" style={{ padding: '4px 0 8px' }}><Avatar name={me.data!.name} tone="brand" large /><b>{me.data!.name}</b></div>
            )}
            {/* TODO [API] Telefon, parol dəyişmə, «Parolu unutmuşam», bildiriş açarları, aktiv sessiyalar, başqa cihazlardan çıxış: serverdə yalnız /whoami (ad) var. */}
            <Button variant="danger" onClick={() => setOut(true)}>Çıxış</Button>
          </Card>
          <Card title="Qoşulmalar">
            <div className="hs-kv"><span><b>WhatsApp (Kapso)</b><span className="tz-sub">{bot.data ? `Bu ay ${bot.data.kapso_month_count} / ${bot.data.kapso_month_limit} mesaj` : bot.err ? 'Yüklənmədi' : '…'}</span></span>
              {bot.data && <Chip tone={bot.data.bot_enabled ? 'done' : 'neutral'}>{bot.data.bot_enabled ? 'Bot açıq' : 'Bot bağlı'}</Chip>}</div>
            <div className="hs-kv"><span><b>Buffer (sosial şəbəkələr)</b>
              <span className="tz-sub">{!info ? 'Yoxlanmayıb' : ch === null ? 'Qoşulmayıb' : ch && !Array.isArray(ch) ? `Xəta: ${ch.error}` : Array.isArray(ch) && ch.length ? ch.map((c) => c.service).join(', ') : 'Kanal yoxdur'}</span></span>
              <Button size="row" variant="text" disabled={buf.busy || !online} onClick={check}>{buf.busy ? '…' : 'Yoxla'}</Button></div>
            {buf.err && <ErrorBox title="Buffer yoxlanmadı" detail={buf.err} />}
            {/* TODO [API] Meta/Instagram, Telegram, Google, Resend, Railway/R2 qoşulma vəziyyəti, son sinxron: yalnız Kapso sayı və Buffer kanalları gəlir. */}
          </Card>
        </div>
        <Card title="App istifadəsi" aside={<span className="tz-aside">müştəri app-ı</span>}>
          <Gate q={dash} title="Statistika yüklənmədi" rows={2}>
            {() => u ? (
              <>
                <div className="hs-uses" data-testid="app-usage">
                  <div className="hs-use"><b>{u.joined}<small> / {u.clients}</small></b><span>Qoşulub</span></div>
                  <div className="hs-use"><b>{u.home_screen}</b><span>Ana ekranda</span></div>
                  <div className="hs-use"><b>{u.push_on}</b><span>Bildiriş açıq</span></div>
                  <div className="hs-use"><b>{u.active_7d}</b><span>Son 7 gündə açıb</span></div>
                </div>
                <p className="tz-muted" style={{ marginTop: 8 }}>Ana ekran və 7 gün yeni versiyadan sonra yığılır.</p>
              </>
            ) : <p className="tz-muted">Məlumat yoxdur.</p>}
          </Gate>
        </Card>
        {/* TODO [API] Məlumat bölməsi (Excel ixracı, ehtiyat nüsxə, silmə): admin endpoint-ləri yoxdur. */}
      </div>
      <Dialog open={out} onClose={() => setOut(false)} title="Çıxış edilsin?" subtitle="Yenidən daxil olmaq üçün login və parol lazımdır."
        footer={<><Button variant="text" onClick={() => setOut(false)}>Qal</Button><Button variant="danger" onClick={signOut}>Çıxış</Button></>} />
    </>
  );
}
