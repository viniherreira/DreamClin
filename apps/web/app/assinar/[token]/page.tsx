import { notFound } from 'next/navigation';
import { getSignature } from './actions';
import { SignForm } from './sign-form';
import { instantDateTimeBR } from '@/lib/tz';

export const metadata = { title: 'Assinar documento', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await getSignature(token);
  if (!s) notFound();
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{s.clinic}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {s.title} · para {s.patientName}
          </p>
        </header>
        <article
          className="doc-body rounded-2xl border border-border bg-surface p-5 text-sm leading-relaxed shadow-sm sm:p-6"
          // O texto foi limpo ao salvar (`sanitizeDocHtml`): só marcas de formatação.
          dangerouslySetInnerHTML={{ __html: s.body }}
        />
        {s.state === 'SIGNED' ? (
          <div role="status" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-center text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            Documento assinado{s.signedAt ? ` em ${instantDateTimeBR(s.signedAt)}` : ''}.{' '}
            <a href={`/assinar/${token}/pdf`} className="font-medium underline">
              Baixar o PDF assinado
            </a>
          </div>
        ) : s.state === 'REFUSED' ? (
          <p role="status" className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted-foreground">
            Você recusou este documento. Se mudou de ideia, peça um novo link à clínica.
          </p>
        ) : s.state === 'EXPIRED' ? (
          <p role="status" className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted-foreground">
            Este link não vale mais. Peça um novo à clínica.
          </p>
        ) : (
          <SignForm token={token} patientName={s.patientName} needsCpf={s.needsCpf} />
        )}
      </div>
    </main>
  );
}
