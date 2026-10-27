import { FormEvent, useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { ApiError } from '../../shared/api';
import { Button, Icon } from '../../shared/ui';
import { useAuth } from '../ctx';
import { go } from '../router';
import type { Client } from '../types';

// B0b: QR oxut → müştəri kartı. Kamera açılmasa kodu əl ilə yazmaq olar.
export function Scan() {
  const { call } = useAuth();
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('Müştərinin QR kodunu çərçivəyə tutun');
  const [manual, setManual] = useState('');
  const lookup = useRef<(code: string) => void>(() => {});

  lookup.current = async (code: string) => {
    try { go(`clients/${(await call<Client>(`/cards/${encodeURIComponent(code.trim())}`)).id}`); }
    catch (e) { setMsg(e instanceof ApiError && e.status === 404 ? 'Bu QR Y Pod kartı deyil.' : (e as Error).message); }
  };

  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(video.current, (r) => { s.stop(); lookup.current(r.data); }, { highlightScanRegion: false, returnDetailedScanResult: true });
    s.start().catch(() => setMsg('Kamera açılmadı. Kodu əl ilə yazın.'));
    return () => s.destroy();
  }, []);

  return (
    <div className="scr ax-scan">
      <div className="pg-nonav">
        <div className="top">
          <a className="iconbtn" href="#/panel" aria-label="Bağla"><Icon name="close" size={22} /></a>
          <span className="h3">QR oxut</span>
          <span style={{ width: 46 }} />
        </div>
      </div>
      <div className="ax-scan-body">
        <div className="ax-frame" role="img" aria-label="Skan çərçivəsi">
          <video ref={video} playsInline muted />
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
        </div>
        <p className="t14 w6 soft lh" style={{ textAlign: 'center', maxWidth: 300 }} role="status">{msg}</p>
        <form className="row" style={{ width: '100%', maxWidth: 340 }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (manual.trim()) lookup.current(manual); }}>
          <input className="inp" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Kodu əl ilə yazın" aria-label="Kart kodu" style={{ flex: 1 }} />
          <Button type="submit" variant="cream" small auto disabled={!manual.trim()}>Tap</Button>
        </form>
        <a className="btn btn-ghost" href="#/clients">Adla axtar</a>
      </div>
    </div>
  );
}
