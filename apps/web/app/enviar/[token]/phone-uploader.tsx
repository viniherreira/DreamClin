'use client';

import { useRef, useState } from 'react';
import { Camera, CheckCircle2, FileUp, XCircle } from 'lucide-react';
import { directUpload } from '@/components/direct-upload';
import { finishPhoneUpload, startPhoneUpload } from './actions';

type Item = { name: string; state: 'enviando' | 'ok' | 'erro'; message?: string };

/** Tirar foto ou escolher arquivos no celular; cada um sobe e mostra se deu certo. */
export function PhoneUploader({ token }: { token: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const cam = useRef<HTMLInputElement>(null);
  const arq = useRef<HTMLInputElement>(null);

  const enviar = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setItems((l) => [...l, { name: file.name, state: 'enviando' }]);
      const r = await directUpload(
        file,
        (m) => startPhoneUpload(token, m),
        (m) => finishPhoneUpload(token, m),
      );
      setItems((l) => l.map((x) => (x.name === file.name && x.state === 'enviando' ? { name: x.name, state: r.ok ? 'ok' : 'erro', message: r.ok ? undefined : r.message } : x)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => cam.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-5 text-sm font-medium shadow-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring">
          <Camera className="h-7 w-7 text-primary" aria-hidden="true" /> Tirar foto
        </button>
        <button type="button" onClick={() => arq.current?.click()} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-5 text-sm font-medium shadow-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring">
          <FileUp className="h-7 w-7 text-primary" aria-hidden="true" /> Escolher arquivos
        </button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void enviar(e.target.files)} />
      <input ref={arq} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void enviar(e.target.files)} />
      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface" aria-live="polite">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 px-4 py-2.5 text-sm">
              {it.state === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="enviado" />
              ) : it.state === 'erro' ? (
                <XCircle className="h-4 w-4 text-destructive" aria-label="falhou" />
              ) : (
                <span className="h-4 w-4 animate-pulse rounded-full bg-primary/40" aria-label="enviando" />
              )}
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              {it.message && <span className="text-xs text-destructive">{it.message}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs text-muted-foreground">Os arquivos vão direto para a ficha na clínica. Este link vale por 15 minutos.</p>
    </div>
  );
}
