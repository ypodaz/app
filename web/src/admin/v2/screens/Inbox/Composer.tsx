import { useEffect, useRef, useState } from 'react';
import { firstLine, type Draft } from '../../../components/crm';
import { useLoad } from '../../../ctx';
import { Button, Switch } from '../../ui';
import { IbIcon } from './icons';

type Quick = { id: number; title: string; text: string };

/** «/ hazır cavab» seçicisi (02 #25): mətn «/» ilə başlayanda açılır, «/su» kimi süzülür. */
function QuickPicker({ query, onPick }: { query: string; onPick: (t: string) => void }) {
  const q = useLoad<Quick[]>('/quick-replies');
  const s = query.toLowerCase();
  const rows = (q.data ?? []).filter((r) => !s || r.title.toLowerCase().includes(s) || r.text.toLowerCase().includes(s));
  return (
    <div className="ibq" role="listbox" aria-label="Hazır cavablar">
      {q.err && <span className="ibq__m">Hazır cavablar yüklənmədi</span>}
      {!q.data && !q.err && <span className="ibq__m">Yüklənir</span>}
      {q.data && !rows.length && <span className="ibq__m">Hazır cavab tapılmadı</span>}
      {rows.map((r) => (
        <button key={r.id} type="button" role="option" aria-selected="false" className="ibq__i" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(r.text)}>
          <b>{r.title}</b><span>{firstLine(r.text)}</span>
        </button>
      ))}
    </div>
  );
}

type FreeProps = {
  /** Fokus avtomatik (E ilə açılanda). */
  autoFocus?: boolean;
  windowOpen: boolean;
  online: boolean;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
};

/** Qaralamasız yazı sahəsi (02 §«qaralama yoxdursa»): mətn + «Göndər ↵». */
export function FreeComposer({ autoFocus, windowOpen, online, busy, onSend }: FreeProps) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  const can = !!text.trim() && windowOpen && online && !busy;
  const submit = async () => { if (can && (await onSend(text.trim()))) setText(''); };
  const picking = text.startsWith('/');
  return (
    <div className="ibc">
      {picking && <QuickPicker query={text.slice(1).trim()} onPick={(t) => { setText(t); area.current?.focus(); }} />}
      <textarea ref={area} rows={2} className="input ibc__ta" aria-label="Mesaj" disabled={!windowOpen} value={text} placeholder={windowOpen ? 'Mesaj yazın…' : 'Pəncərə bağlıdır'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } if (e.key === 'Escape') setText(''); }} />
      <div className="ibc__bar">
        <span className="ibc__hint"><kbd className="mono">/</kbd> hazır cavab</span>
        <Button variant="primary" size="md" kbd="↵" disabled={!can} onClick={() => void submit()}>Göndər</Button>
      </div>
    </div>
  );
}

type DraftProps = {
  draft: Draft;
  /** «Komandaya ötürülüb»: ikonsuz «Siz baxana qədər gözləyir». */
  mode: 'wait' | 'owner' | 'bot' | 'human';
  windowOpen: boolean;
  online: boolean;
  onSend: (text: string, edited: boolean) => void;
  onReject: () => void;
  /** Instagram/YouTube: «Yenidən yaz» (Telegram-dakı 🔄 ilə eyni). */
  onRegenerate?: () => void;
  /** Üst sətirdə «Siz baxana qədər gözləyir» yerinə göstərilən mətn (məs. Instagram taymeri). */
  note?: string;
};

/** AI qaralama kartı (02 #19–#24, 03 E4–E6a). */
export const DraftCard = ({ draft, mode, windowOpen, online, onSend, onReject, onRegenerate, note }: DraftProps) => {
  const [text, setText] = useState(draft.text);
  const [edit, setEdit] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(draft.text); setEdit(false); }, [draft.id, draft.text]);
  useEffect(() => { if (edit) { const a = area.current; a?.focus(); a?.setSelectionRange(a.value.length, a.value.length); } }, [edit]);
  const can = !!text.trim() && windowOpen && online;
  const edited = text.trim() !== draft.text.trim();
  const send = () => { if (can) onSend(text.trim(), edited); };
  return (
    <div className="ibd">
      <div className="ibd__card">
        <div className="ibd__top">
          {/* TODO [API] «Siz yazdınız» qaralamasının taymeri («N dəq sonra bot özü göndərəcək», «Özü göndərməsin»): draft_out auto_at qaytarmır, ona görə yalnız «Komandaya ötürülüb» sətri göstərilir. */}
          {note ? <span className="ibd__wait">{note}</span> : mode === 'wait' ? <span className="ibd__wait">Siz baxana qədər gözləyir</span> : <span />}
          <span className="ibd__ai">AI qaralaması{edit ? ' · redaktə edə bilərsiniz' : ''}</span>
        </div>
        <textarea ref={area} className="ibd__ta" rows={3} readOnly={!edit} aria-label="Qaralama mətni" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (edit && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') setEdit(false); }} />
      </div>
      <div className="ibd__acts">
        <Button variant="primary" size="md" kbd="↵" disabled={!can} onClick={send}>İndi göndər</Button>
        {!edit && <Button variant="text" size="md" onClick={() => setEdit(true)}>Redaktə et</Button>}
        {onRegenerate && !edit && <Button variant="text" size="md" disabled={!online} onClick={onRegenerate}>Yenidən yaz</Button>}
        <Button variant="text" size="md" onClick={onReject}>Rədd et</Button>
        <span className="ibc__hint ibd__slash"><kbd className="mono">/</kbd> hazır cavab</span>
      </div>
    </div>
  );
};

/** «Dostdur · bot yazmır» açarı (02 #29, #31). */
export function FriendSwitch({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ibf">
      <Switch checked={on} onChange={onChange} label="Dostdur · bot yazmır" disabled={disabled} />
      <span>Dostdur · bot yazmır{on && <small>Telegram-dakı düymə ilə eyni</small>}</span>
    </label>
  );
}

/** «Bot aparır» yazı sahəsi (02 #26–#29). */
export function BotBar({ onWrite, friend, onFriend, disabled }: { onWrite: () => void; friend: boolean; onFriend: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="ibb">
      <div className="ibb__t"><IbIcon name="bot" size={18} /><b>Bot bu söhbəti aparır.</b><span>Siz yazsanız, bot yalnız qaralama hazırlayacaq</span></div>
      <div className="ibb__r">
        <Button variant="primary" size="md" kbd="E" disabled={disabled} onClick={onWrite}>Cavabı mən yazım</Button>
        <FriendSwitch on={friend} disabled={disabled} onChange={onFriend} />
      </div>
    </div>
  );
}

/** «Bot susur» yazı sahəsinin üstü (02 #30–#32). */
export function SilentBar({ friend, onFriend, onBot, disabled }: { friend: boolean; onFriend: (v: boolean) => void; onBot: () => void; disabled: boolean }) {
  return (
    <div className="ibb ibb--silent">
      <div className="ibb__t"><b>Bot bu söhbətə cavab yazmır</b></div>
      <div className="ibb__r">
        <FriendSwitch on={friend} disabled={disabled} onChange={onFriend} />
        <Button size="md" disabled={disabled} onClick={onBot}>Bot yazsın</Button>
      </div>
    </div>
  );
}
