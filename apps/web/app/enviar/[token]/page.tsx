import { notFound } from 'next/navigation';
import { getUploadSession } from './actions';
import { PhoneUploader } from './phone-uploader';

export const metadata = { title: 'Enviar fotos', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function PhoneUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await getUploadSession(token);
  if (!s) notFound();
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        <header className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{s.clinic}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Fotos e documentos{s.firstName ? ` de ${s.firstName}` : ''} · pasta {s.folder}
          </p>
        </header>
        {s.open ? (
          <PhoneUploader token={token} />
        ) : (
          <p role="status" className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted-foreground">
            Este link não vale mais. Peça um novo QR code à clínica.
          </p>
        )}
      </div>
    </main>
  );
}
