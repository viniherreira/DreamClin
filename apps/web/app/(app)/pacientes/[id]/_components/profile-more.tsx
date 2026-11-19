'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CreditCard, FileDown, FileText } from 'lucide-react';

/**
 * O "Mais" do cabeçalho: ficha do paciente (com as opções de impressão),
 * cartão do paciente, exportar e anonimizar (LGPD) e inativar.
 */
export function ProfileMore({
  patientId,
  canExport,
  canPrivacy,
  active,
  toggleActive,
}: {
  patientId: string;
  canExport: boolean;
  canPrivacy: boolean;
  active: boolean;
  toggleActive: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [ficha, setFicha] = useState(false);
  const [op, setOp] = useState({ formato: 'pdf', cabecalho: true, rodape: true, linhas: 0, titulo: 'Ficha do paciente' });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const fichaUrl = `/pacientes/${patientId}/ficha?${new URLSearchParams({
    formato: op.formato,
    cabecalho: op.cabecalho ? '1' : '0',
    rodape: op.rodape ? '1' : '0',
    linhas: String(op.linhas),
    titulo: op.titulo,
  })}`;

  const item = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-ring';

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-haspopup="true" className="btn-outline btn-sm">
        Mais <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {aberto && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {canExport && (
            <button type="button" className={item} onClick={() => { setFicha(true); setAberto(false); }}>
              <FileText className="h-4 w-4" aria-hidden="true" /> Ficha do paciente
            </button>
          )}
          <a href={`/pacientes/${patientId}/cartao`} target="_blank" rel="noreferrer" className={item}>
            <CreditCard className="h-4 w-4" aria-hidden="true" /> Cartão do paciente
          </a>
          {canPrivacy && (
            <>
              <a href={`/pacientes/${patientId}/exportar`} className={item}>
                <FileDown className="h-4 w-4" aria-hidden="true" /> Exportar dados (LGPD)
              </a>
              <a href={`/pacientes/${patientId}?aba=dados#lgpd`} className={item}>
                Anonimizar (LGPD)
              </a>
            </>
          )}
          <form action={toggleActive}>
            <button type="submit" className={item}>
              {active ? 'Inativar paciente' : 'Reativar paciente'}
            </button>
          </form>
        </div>
      )}
      {ficha && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setFicha(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-labelledby="ficha-titulo" className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <h2 id="ficha-titulo" className="text-base font-semibold">
              Ficha do paciente
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Formato</span>
                <select value={op.formato} onChange={(e) => setOp({ ...op, formato: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2">
                  <option value="pdf">PDF (imprimir)</option>
                  <option value="xlsx">Excel (XLSX)</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              {op.formato === 'pdf' && (
                <>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Título</span>
                    <input value={op.titulo} onChange={(e) => setOp({ ...op, titulo: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2" />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={op.cabecalho} onChange={(e) => setOp({ ...op, cabecalho: e.target.checked })} className="h-4 w-4 accent-primary" /> Cabeçalho da clínica
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={op.rodape} onChange={(e) => setOp({ ...op, rodape: e.target.checked })} className="h-4 w-4 accent-primary" /> Rodapé
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Linhas em branco no fim (para anotar à mão)</span>
                    <input type="number" min={0} max={30} value={op.linhas} onChange={(e) => setOp({ ...op, linhas: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} className="mt-1 h-9 w-24 rounded-lg border border-border bg-background px-2" />
                  </label>
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setFicha(false)} className="btn-outline btn-md">
                Fechar
              </button>
              <a href={fichaUrl} target="_blank" rel="noreferrer" onClick={() => setFicha(false)} className="btn-primary btn-md">
                Gerar ficha
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
