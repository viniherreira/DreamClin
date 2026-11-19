'use client';

import { useEffect } from 'react';

/**
 * As listas com a cara do sistema (`appearance: base-select` em globals.css)
 * ficam do tamanho da opção escolhida, e mudar a opção mudaria a largura do
 * campo. A lista antiga do navegador tinha a largura da opção mais comprida:
 * aqui cada lista ganha essa largura mínima (sem passar do espaço que tem).
 * Navegador sem a lista nova: não faz nada.
 */

const medidor = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

function ajustar(s: HTMLSelectElement) {
  if (!medidor || s.multiple || s.size > 1) return;
  const cs = getComputedStyle(s);
  if (cs.appearance !== 'base-select' || cs.display === 'none') return;
  medidor.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const maiusculo = cs.textTransform === 'uppercase';
  let maior = 0;
  for (const o of Array.from(s.options)) {
    const t = maiusculo ? o.text.toUpperCase() : o.text;
    maior = Math.max(maior, medidor.measureText(t).width);
  }
  const px = (v: string) => Number.parseFloat(v) || 0;
  // Texto + espaços dos lados + borda + a setinha (1rem) e o espaço até ela.
  const largura = Math.ceil(
    maior + px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth) + px(cs.fontSize) * 1.6 + 6,
  );
  const valor = `min(${largura}px, 100%)`;
  if (s.style.minInlineSize !== valor) s.style.minInlineSize = valor;
}

export function SelectSizing() {
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.supports('appearance', 'base-select')) return;
    let agendado = 0;
    const tudo = () => {
      agendado = 0;
      document.querySelectorAll('select').forEach(ajustar);
    };
    const agendar = () => {
      if (!agendado) agendado = requestAnimationFrame(tudo);
    };
    tudo();
    // Telas novas, modais e opções que mudam (o React troca as listas sem recarregar).
    const obs = new MutationObserver(agendar);
    obs.observe(document.body, { childList: true, subtree: true });
    // A fonte do site chega depois: mede de novo.
    void document.fonts?.ready.then(agendar);
    return () => {
      obs.disconnect();
      if (agendado) cancelAnimationFrame(agendado);
    };
  }, []);
  return null;
}
