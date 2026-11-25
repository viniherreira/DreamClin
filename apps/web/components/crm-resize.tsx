'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Largura de um painel que a pessoa ajusta arrastando a borda, como no Kommo.
 * Fica guardada neste navegador (cada um arruma a tela do seu jeito); sem
 * acesso ao armazenamento, vale a largura padrão.
 */
export function usePanelWidth(key: string, fallback: number, min: number, max: number) {
  const [width, setWidthState] = useState(fallback);
  const clamp = useCallback((v: number) => Math.round(Math.min(max, Math.max(min, v))), [min, max]);

  // Lida depois de montar: no servidor não há armazenamento e a tela não pode desencontrar.
  useEffect(() => {
    try {
      const salvo = Number(window.localStorage.getItem(`crm-largura:${key}`));
      if (salvo) setWidthState(clamp(salvo));
    } catch {
      /* sem armazenamento: fica a padrão */
    }
  }, [key, clamp]);

  const setWidth = useCallback(
    (v: number) => {
      const w = clamp(v);
      setWidthState(w);
      try {
        window.localStorage.setItem(`crm-largura:${key}`, String(w));
      } catch {
        /* sem armazenamento: vale só nesta visita */
      }
    },
    [key, clamp],
  );

  return { width, setWidth, reset: () => setWidth(fallback), min, max };
}

/**
 * A alça na borda direita de um painel (o pai precisa de `relative`).
 * Arrastar muda a largura; pelo teclado, setas para os lados; dois cliques
 * voltam ao tamanho padrão.
 */
export function ResizeHandle({
  label,
  panel,
  className = '',
}: {
  /** "Largura da lista de conversas". */
  label: string;
  panel: ReturnType<typeof usePanelWidth>;
  className?: string;
}) {
  const inicio = useRef<{ x: number; w: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  return (
    // Separador que recebe foco é o "window splitter" do ARIA: interativo de verdade
    // (setas mudam a largura), mas o lint só conhece o separador decorativo.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      title="Arraste para ajustar. Dois cliques voltam ao tamanho padrão."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        inicio.current = { x: e.clientX, w: panel.width };
        setArrastando(true);
      }}
      onPointerMove={(e) => {
        if (!inicio.current) return;
        panel.setWidth(inicio.current.w + e.clientX - inicio.current.x);
      }}
      onPointerUp={(e) => {
        inicio.current = null;
        setArrastando(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        inicio.current = null;
        setArrastando(false);
      }}
      onDoubleClick={panel.reset}
      onKeyDown={(e) => {
        const passo = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') panel.setWidth(panel.width - passo);
        else if (e.key === 'ArrowRight') panel.setWidth(panel.width + passo);
        else if (e.key === 'Home') panel.setWidth(panel.min);
        else if (e.key === 'End') panel.setWidth(panel.max);
        else return;
        e.preventDefault();
      }}
      className={`group absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none select-none lg:block focus-visible:outline-none ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary ${arrastando ? 'bg-primary' : 'bg-transparent'}`}
      />
    </div>
  );
}

/**
 * Duas colunas: a da esquerda com a largura que a pessoa ajusta, a da direita
 * com o resto (a ficha do lead). Em tela pequena, uma embaixo da outra.
 */
export function ResizableSplit({
  storageKey,
  fallback,
  min,
  max,
  label,
  left,
  leftClassName = '',
  children,
}: {
  storageKey: string;
  fallback: number;
  min: number;
  max: number;
  label: string;
  left: React.ReactNode;
  leftClassName?: string;
  children: React.ReactNode;
}) {
  const panel = usePanelWidth(storageKey, fallback, min, max);
  return (
    <div
      style={{ '--esquerda': `${panel.width}px` } as React.CSSProperties}
      className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[var(--esquerda)_minmax(0,1fr)]"
    >
      <div className={`relative min-h-0 min-w-0 ${leftClassName}`}>
        <ResizeHandle label={label} panel={panel} />
        {left}
      </div>
      {children}
    </div>
  );
}
