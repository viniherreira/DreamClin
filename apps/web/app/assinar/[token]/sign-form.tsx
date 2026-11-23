'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSignatureViewed, refuseDocument, signDocument } from './actions';

/** Formulário de assinatura: nome, CPF, desenhar (dedo ou mouse) ou aceitar, e recusar. */
export function SignForm({ token, patientName, needsCpf }: { token: string; patientName: string; needsCpf: boolean }) {
  const router = useRouter();
  const [nome, setNome] = useState(patientName);
  const [cpf, setCpf] = useState('');
  const [modo, setModo] = useState<'DRAWN' | 'ACCEPTED'>('DRAWN');
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [desenhou, setDesenhou] = useState(false);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);

  useEffect(() => {
    void markSignatureViewed(token);
  }, [token]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || modo !== 'DRAWN') return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1A1F2B';
  }, [modo]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const limpar = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setDesenhou(false);
  };

  const assinar = () =>
    start(async () => {
      setErro('');
      const drawing = modo === 'DRAWN' ? canvas.current?.toDataURL('image/png') : undefined;
      const r = await signDocument(token, { name: nome, cpf, method: modo, drawing, agree: aceito });
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });

  return (
    <section aria-labelledby="assinar-titulo" className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
      <h2 id="assinar-titulo" className="text-base font-semibold">
        Assinar
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Nome completo</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" autoComplete="name" />
        </label>
        {needsCpf && (
          <label className="block text-sm">
            <span className="font-medium">CPF</span>
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3" placeholder="000.000.000-00" />
          </label>
        )}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Como quer assinar</legend>
        <div className="mt-1 flex gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="modo" checked={modo === 'DRAWN'} onChange={() => setModo('DRAWN')} className="h-4 w-4 accent-primary" /> Desenhar a assinatura
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="modo" checked={modo === 'ACCEPTED'} onChange={() => setModo('ACCEPTED')} className="h-4 w-4 accent-primary" /> Só aceitar
          </label>
        </div>
      </fieldset>
      {modo === 'DRAWN' && (
        <div>
          <canvas
            ref={canvas}
            aria-label="Quadro para desenhar a assinatura com o dedo ou o mouse"
            role="img"
            className="h-40 w-full touch-none rounded-lg border border-dashed border-border bg-white"
            onPointerDown={(e) => {
              desenhando.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const ctx = e.currentTarget.getContext('2d');
              const p = pos(e);
              ctx?.beginPath();
              ctx?.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!desenhando.current) return;
              const ctx = e.currentTarget.getContext('2d');
              const p = pos(e);
              ctx?.lineTo(p.x, p.y);
              ctx?.stroke();
              setDesenhou(true);
            }}
            onPointerUp={() => {
              desenhando.current = false;
            }}
          />
          <button type="button" onClick={limpar} className="btn-ghost btn-sm mt-1">
            Limpar
          </button>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>Li o documento acima e concordo com ele.</span>
      </label>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {recusando ? (
          <div className="flex w-full flex-wrap gap-2">
            <label className="sr-only" htmlFor="motivo-recusa">
              Motivo da recusa
            </label>
            <input id="motivo-recusa" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await refuseDocument(token, motivo);
                  if (!r.ok) setErro(r.message);
                  else router.refresh();
                })
              }
              className="btn-outline btn-sm"
            >
              Confirmar recusa
            </button>
            <button type="button" onClick={() => setRecusando(false)} className="btn-ghost btn-sm">
              Voltar
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setRecusando(true)} className="btn-ghost btn-sm">
              Recusar
            </button>
            <button type="button" disabled={pending || !aceito || (modo === 'DRAWN' && !desenhou)} onClick={assinar} className="btn-primary btn-md">
              {pending ? 'Assinando…' : 'Assinar documento'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
