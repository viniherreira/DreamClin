import { notFound } from 'next/navigation';
import { getQuestionnaire } from './actions';
import { QuestionnaireForm } from './questionnaire-form';

export const metadata = { title: 'Questionário', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function QuestionnairePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuestionnaire(token);
  if (!q) notFound();
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{q.clinic}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{q.name}</p>
        </header>
        {q.state === 'ANSWERED' ? (
          <p role="status" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-center text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            Respostas enviadas. Obrigado!
          </p>
        ) : q.state === 'EXPIRED' ? (
          <p role="status" className="rounded-2xl border border-border bg-surface p-5 text-center text-sm text-muted-foreground">
            Este link não vale mais. Peça um novo à clínica.
          </p>
        ) : (
          <QuestionnaireForm token={token} firstName={q.firstName} questions={q.questions} />
        )}
      </div>
    </main>
  );
}
