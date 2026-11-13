import { useEffect, useRef, useState } from 'react';
import { usePoll, type Conv } from '../../../components/crm';
import { useLoad } from '../../../ctx';
import { go, useMedia, useRoute } from '../../../router';
import { useShellData } from '../../data/ShellData';
import { socialPath, type Kanal, type SocialList, type SocialThread } from '../../data/social';
import { EmptyState } from '../../ui';
import { Chat } from './Chat';
import { ConvList } from './ConvList';
import { groupOf, sortGroup, typing } from './logic';
import { DmChat, PostView } from './SocialChat';
import './inbox.css';

const KANAL_KEY = 'ypod.v2.inbox.kanal';
const KANALS: Kanal[] = ['hamisi', 'whatsapp', 'instagram', 'komment'];
const readKanal = (): Kanal => { try { const v = localStorage.getItem(KANAL_KEY); return KANALS.includes(v as Kanal) ? (v as Kanal) : 'hamisi'; } catch { return 'hamisi'; } };

export type SocialSel = Pick<SocialThread, 'kind' | 'channel' | 'thread_id'>;

/** Inbox (02-inbox.md): siyahı · söhbət · İnsan paneli. Route: /inbox, /inbox/<id>, /inbox/ig/<thread>, /inbox/komment/<kanal>/<post>. */
export function Inbox({ id, social }: { id?: number; social?: SocialSel }) {
  const sd = useShellData();
  const botOn = sd.raw?.botEnabled !== false;
  const { query } = useRoute();
  const list = useLoad<Conv[]>('/inbox'); // GET /inbox/{id} söhbəti oxunmuş edir — önizləmə üçün çağırılmır
  const soc = useLoad<SocialList>('/social-inbox');
  const reloadAll = () => { list.reload(); soc.reload(); };
  usePoll(reloadAll, 20_000);
  const wide = useMedia('(min-width:1100px)');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const search = useRef<HTMLInputElement>(null);
  const order = useRef<string[]>([]);

  // Kanal filtri: URL ?kanal= üstündür, sonra bu brauzerdə yadda qalan seçim (02 #3).
  const qk = query.get('kanal') as Kanal | null;
  const [kanal, setKanalState] = useState<Kanal>(() => (qk && KANALS.includes(qk) ? qk : readKanal()));
  useEffect(() => { if (qk && KANALS.includes(qk)) setKanalState(qk); }, [qk]);
  const setKanal = (k: Kanal) => { setKanalState(k); try { localStorage.setItem(KANAL_KEY, k); } catch { /* yaddaş bağlıdır */ } };

  const current = id ? `inbox/${id}` : social ? socialPath(social) : '';
  const open = !!current;

  // Standart seçim (02): geniş ekranda /inbox açılanda «Sizi gözləyir»in 1-ci sətri açılır.
  const convs = list.data;
  const firstId = convs && (kanal === 'hamisi' || kanal === 'whatsapp') ? sortGroup(convs.filter((c) => groupOf(c, botOn) === 'you'), 'you', botOn)[0]?.id : undefined;
  // «Sizi gözləyir» yığılıbsa (ConvList, ypod.v2.inbox.closed) avtomatik açılmır: sahibkar son yazışmalara baxmaq istəyir.
  const youClosed = (() => { try { return !!JSON.parse(localStorage.getItem('ypod.v2.inbox.closed') ?? '{}').you; } catch { return false; } })();
  // Söhbət bir dəfə açılıbsa geri qayıdanda yenidən avtomatik açılmır («Oxunmamış et» söhbəti dərhal geri açmasın).
  const opened = useRef(false);
  if (open) opened.current = true;
  useEffect(() => { if (wide && !open && firstId && !youClosed && !opened.current) location.replace(`#/inbox/${firstId}`); }, [wide, open, firstId, youClosed]);

  // J/K: növbəti/əvvəlki söhbət; /: axtarış.
  const keyRef = useRef<(e: KeyboardEvent) => void>();
  keyRef.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === '/') { e.preventDefault(); search.current?.focus(); return; }
    const k = e.key.toLowerCase();
    if (k !== 'j' && k !== 'k') return;
    const o = order.current;
    if (!o.length) return;
    const i = current ? o.indexOf(current) : -1;
    const next = k === 'j' ? o[Math.min(o.length - 1, i + 1)] : o[Math.max(0, i - 1)];
    if (next && next !== current) go(next);
  };
  useEffect(() => { const on = (e: KeyboardEvent) => keyRef.current?.(e); window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on); }, []);

  return (
    <div className={`ib${open ? ' ib--chat' : ''}`}>
      <ConvList convs={convs} social={soc.data?.threads} commentMode={soc.data?.comment_mode} kanal={kanal} onKanal={setKanal}
        error={list.err} onRetry={reloadAll} botOn={botOn} now={now} sel={current} searchRef={search} onOrder={(o) => { order.current = o; }} />
      {id
        ? <Chat key={id} id={id} botOn={botOn} onChanged={list.reload} onBack={() => go('inbox')} />
        : social?.kind === 'dm'
          ? <DmChat key={current} thread={social.thread_id} onChanged={soc.reload} onBack={() => go('inbox')} />
          : social
            ? <PostView key={current} channel={social.channel} thread={social.thread_id} onChanged={soc.reload} onBack={() => go('inbox')} />
            : <div className="ib__cw ib__cw--empty"><EmptyState title="Söhbət seçin" reason="Soldakı siyahıdan müştərini açın." /></div>}
    </div>
  );
}
