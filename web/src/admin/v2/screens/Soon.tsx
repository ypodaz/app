import { PageHeader } from '../shell/PageHeader';

/** Hələ qurulmamış ekran: yeni qabığın içində sadə «Tezliklə». Sənəd: handoff/davranis/<doc>. */
export function Soon({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <PageHeader title={title} sub={sub} />
      <section className="soon" aria-label={`${title} · tezliklə`}>
        <h2 className="soon__t">Tezliklə</h2>
        <p className="soon__s">Bu ekran yeni dizaynda hələ hazır deyil.</p>
      </section>
    </>
  );
}
