'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, MessageCircle, QrCode } from 'lucide-react';

/**
 * Um link para o paciente (assinatura, questionário, envio pelo celular):
 * copiar, mandar pelo WhatsApp (abre a conversa com o texto pronto) ou mostrar
 * o QR code para ler na recepção.
 */
export function ShareLink({ url, phone, text, qrOpen = false }: { url: string; phone?: string; text: string; qrOpen?: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [aberto, setAberto] = useState(qrOpen);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (aberto && !qr) void QRCode.toDataURL(url, { margin: 1, width: 240 }).then(setQr);
  }, [aberto, qr, url]);
  const d = (phone ?? '').replace(/\D/g, '');
  const wa = d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(`${text} ${url}`)}` : null;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`link-${url.slice(-8)}`}>
          Link
        </label>
        <input id={`link-${url.slice(-8)}`} readOnly value={url} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface-alt/50 px-2 text-xs" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          }}
          className="btn-outline btn-sm"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="btn-outline btn-sm">
            <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Mandar pelo WhatsApp
          </a>
        )}
        <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="btn-ghost btn-sm">
          <QrCode className="h-3.5 w-3.5" aria-hidden="true" /> {aberto ? 'Esconder QR code' : 'Mostrar QR code'}
        </button>
      </div>
      {aberto && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code do link para ler com o celular" className="h-48 w-48 rounded-lg border border-border bg-white p-2" />
      )}
    </div>
  );
}
