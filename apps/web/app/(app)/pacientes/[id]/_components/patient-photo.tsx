'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { PatientAvatar } from '../../_components/patient-avatar';
import { removePatientPhoto, uploadPatientPhoto } from '../profile-actions';

/**
 * Foto do paciente no cabeçalho: enviar do computador, tirar pela câmera
 * (no celular abre a câmera direto) e tirar a foto.
 */
export function PatientPhoto({ patientId, name, url, canEdit }: { patientId: string; name: string; url: string | null; canEdit: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();

  const enviar = (file: File | undefined) => {
    if (!file) return;
    setErro('');
    setAberto(false);
    const fd = new FormData();
    fd.set('photo', file);
    start(async () => {
      const r = await uploadPatientPhoto(patientId, fd);
      if (!r.ok) setErro(r.message);
    });
  };

  return (
    <div className="relative w-fit shrink-0">
      <div className={`rounded-full bg-surface p-1 shadow-card ${pending ? 'opacity-60' : ''}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Foto de ${name}`} className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <PatientAvatar name={name} size="xl" />
        )}
      </div>
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            aria-expanded={aberto}
            aria-label={url ? 'Trocar a foto' : 'Pôr uma foto'}
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
          </button>
          {aberto && (
            <div className="absolute left-0 top-full z-30 mt-2 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg">
              <button type="button" onClick={() => fileRef.current?.click()} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring">
                Enviar uma foto
              </button>
              <button type="button" onClick={() => camRef.current?.click()} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring">
                Tirar pela câmera
              </button>
              {url && (
                <button
                  type="button"
                  onClick={() => {
                    setAberto(false);
                    start(async () => {
                      const r = await removePatientPhoto(patientId);
                      if (!r.ok) setErro(r.message);
                    });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Tirar a foto
                </button>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => enviar(e.target.files?.[0])} />
          <input ref={camRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => enviar(e.target.files?.[0])} />
        </>
      )}
      {erro && (
        <p role="alert" className="absolute left-0 top-full mt-1 w-56 text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
