'use client';

import { useEffect } from 'react';

/**
 * As listas com a cara do sistema (`appearance: base-select` em globals.css)
 * ficam do tamanho da opção escolhida, e mudar a opção mudaria a largura do
 * campo. A lista antiga do navegador tinha a largura da opção mais comprida:
 * aqui cada lista ganha essa largura mínima (sem passar do espaço que tem).
 * Navegador sem a lista nova: não faz nada.
 *
 * Só mexe na lista que o React já assumiu. Uma parte da página que ainda chega
 * por streaming (dentro de um Suspense) tem o HTML pronto antes do React: pôr
 * o `style` nela antes da hora dava o aviso de hidratação ("attributes of the
 * server rendered HTML didn't match"). Essas ficam para a próxima rodada.
 */

const medidor = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/** O React já hidratou este elemento? Ele grava a fibra numa chave `__reactFiber$…`. */
function hidratado(el: Element): boolean {
  return Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
}

/** Ajusta a lista. Devolve false quando ela ainda espera o React. */
function ajustar(s: HTMLSelectElement): boolean {
  if (!medidor || s.multiple || s.size > 1) return true;
  if (!hidratado(s)) return false;
  const cs = getComputedStyle(s);
  if (cs.appearance !== 'base-select' || cs.display === 'none') return true;
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
  return true;
}

export function SelectSizing() {
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.supports('appearance', 'base-select')) return;
    let agendado = 0;
    let espera: ReturnType<typeof setTimeout> | null = null;
    let tentativas = 0;
    const tudo = () => {
      agendado = 0;
      let faltam = 0;
      document.querySelectorAll('select').forEach((s) => {
        if (!ajustar(s)) faltam++;
      });
      // A hidratação de uma parte que chegou depois não muda o DOM (o observador
      // não avisa): tenta de novo um pouco depois, algumas vezes.
      if (faltam && tentativas < 20 && !espera) {
        tentativas++;
        espera = setTimeout(() => {
          espera = null;
          agendar();
        }, 400);
      }
    };
    const agendar = () => {
      if (!agendado) agendado = requestAnimationFrame(tudo);
    };
    agendar();
    // Telas novas, modais e opções que mudam (o React troca as listas sem recarregar).
    const obs = new MutationObserver(() => {
      tentativas = 0;
      agendar();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Antes de abrir uma lista, garante a largura dela.
    const antesDeAbrir = (e: Event) => {
      if (e.target instanceof HTMLSelectElement) ajustar(e.target);
    };
    document.addEventListener('pointerdown', antesDeAbrir, true);
    document.addEventListener('focusin', antesDeAbrir, true);
    // A fonte do site chega depois: mede de novo.
    void document.fonts?.ready.then(agendar);
    return () => {
      obs.disconnect();
      document.removeEventListener('pointerdown', antesDeAbrir, true);
      document.removeEventListener('focusin', antesDeAbrir, true);
      if (agendado) cancelAnimationFrame(agendado);
      if (espera) clearTimeout(espera);
    };
  }, []);
  return null;
}
