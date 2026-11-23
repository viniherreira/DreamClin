'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Question } from '@/lib/questionnaire';
import { markQuestionnaireOpened, submitQuestionnaire } from './actions';

type Answer = { v: string | string[]; obs?: string };

const input = 'mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

/** As perguntas, uma embaixo da outra, no celular. */
export function QuestionnaireForm({ token, firstName, questions }: { token: string; firstName: string; questions: Question[] }) {
  const router = useRouter();
  const [ans, setAns] = useState<Record<string, Answer>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    void markQuestionnaireOpened(token);
  }, [token]);
  const set = (id: string, a: Answer) => setAns((x) => ({ ...x, [id]: a }));

  return (
    <form
      className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErro('');
          const r = await submitQuestionnaire(token, ans);
          if (r.ok) router.refresh();
          else {
            setErro(r.message);
            setErrors(r.errors ?? {});
          }
        });
      }}
    >
      {firstName && <p className="text-sm">Olá, {firstName}! Responda com calma. Leva poucos minutos.</p>}
      {questions.map((q, i) => {
        const a = ans[q.id];
        const id = `q-${q.id}`;
        const err = errors[q.id];
        const rotulo = (
          <>
            {i + 1}. {q.label}
            {q.required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
          </>
        );
        if (q.type === 'YESNO' || q.type === 'SINGLE' || q.type === 'MULTI') {
          const opcoes = q.type === 'YESNO' ? ['Sim', 'Não'] : q.options;
          return (
            <fieldset key={q.id} aria-describedby={err ? `${id}-erro` : undefined}>
              <legend className="text-sm font-medium">{rotulo}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {opcoes.map((o) => {
                  const marcado = Array.isArray(a?.v) ? a!.v.includes(o) : a?.v === o;
                  return (
                    <label key={o} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${marcado ? 'border-primary bg-primary/10' : 'border-border'}`}>
                      <input
                        type={q.type === 'MULTI' ? 'checkbox' : 'radio'}
                        name={id}
                        checked={marcado}
                        onChange={() => {
                          if (q.type === 'MULTI') {
                            const l = Array.isArray(a?.v) ? a!.v : [];
                            set(q.id, { v: marcado ? l.filter((x) => x !== o) : [...l, o] });
                          } else set(q.id, { v: o, obs: a?.obs });
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
              {q.type === 'YESNO' && a?.v === 'Sim' && (
                <label className="mt-2 block text-sm">
                  <span className="text-muted-foreground">Conte mais (opcional)</span>
                  <input value={a.obs ?? ''} onChange={(e) => set(q.id, { v: 'Sim', obs: e.target.value })} className={input} />
                </label>
              )}
              {err && (
                <p id={`${id}-erro`} role="alert" className="mt-1 text-xs text-destructive">
                  {err}
                </p>
              )}
            </fieldset>
          );
        }
        return (
          <div key={q.id}>
            <label htmlFor={id} className="text-sm font-medium">
              {rotulo}
            </label>
            {q.type === 'LONG_TEXT' ? (
              <textarea id={id} rows={3} value={typeof a?.v === 'string' ? a.v : ''} onChange={(e) => set(q.id, { v: e.target.value })} className={input} />
            ) : (
              <input
                id={id}
                type={q.type === 'DATE' ? 'date' : 'text'}
                inputMode={q.type === 'NUMBER' ? 'decimal' : undefined}
                value={typeof a?.v === 'string' ? a.v : ''}
                onChange={(e) => set(q.id, { v: e.target.value })}
                className={input}
                aria-describedby={err ? `${id}-erro` : undefined}
              />
            )}
            {err && (
              <p id={`${id}-erro`} role="alert" className="mt-1 text-xs text-destructive">
                {err}
              </p>
            )}
          </div>
        );
      })}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary btn-md w-full justify-center">
        {pending ? 'Enviando…' : 'Enviar respostas'}
      </button>
    </form>
  );
}
