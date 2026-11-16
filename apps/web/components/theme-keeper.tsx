'use client';

import { useEffect } from 'react';

/**
 * Repõe o tema depois que a página monta.
 *
 * O tema é uma classe no <html>, posta por um script antes da primeira pintura
 * (`app/layout.tsx`). Se uma tela falha ao hidratar fora de um Suspense, o React
 * redesenha o documento inteiro e a classe some: a pessoa escolheu o escuro e a
 * tela abre clara. Aqui a mesma regra do script roda de novo, já com o React no
 * controle. No CRM quem manda é o `CrmTheme`, que tem as próprias classes.
 */
export function ThemeKeeper() {
  useEffect(() => {
    const c = document.documentElement.classList;
    if (c.contains('crm-navy') || c.contains('crm-light')) return;
    let dark = false;
    try {
      const t = localStorage.getItem('theme');
      dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch {
      /* sem armazenamento: fica o claro */
    }
    c.toggle('dark', dark);
  }, []);
  return null;
}
