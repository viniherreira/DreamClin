/**
 * A conta de um recebimento (ou pagamento) com vários meios: quanto cada meio
 * quita do título, o troco e o que sobra em aberto. Puro e testado em
 * `settlement.test.ts`. Tudo em centavos.
 *
 * Regras:
 * - total a receber = em aberto − desconto + acréscimo + juros + multa;
 * - receber menos que o total é baixa parcial: juros, multa e acréscimo saem
 *   primeiro, o resto abate o título;
 * - receber mais só em dinheiro: a sobra volta de troco ou vira crédito na carteira;
 * - `principal` de cada meio é quanto ele quita do título; a soma mais o
 *   desconto nunca passa do em aberto.
 */

export interface PlanLine {
  amount: number;
  /** Meio em dinheiro: o único que aceita valor a mais (troco). */
  isCash: boolean;
}

export interface PlanInput {
  open: number;
  lines: readonly PlanLine[];
  discount?: number;
  surcharge?: number;
  interest?: number;
  fine?: number;
  /** O que fazer com o dinheiro a mais. */
  change?: 'RETURN' | 'WALLET';
  /** Crédito na carteira só existe para paciente. */
  walletAvailable?: boolean;
}

export interface PlannedLine {
  /** Dinheiro deste meio que fica com a clínica (já sem o troco e sem o que foi para a carteira). */
  kept: number;
  principal: number;
  discount: number;
  surcharge: number;
  interest: number;
  fine: number;
}

export type Plan =
  | {
      ok: true;
      lines: PlannedLine[];
      /** Total a receber para quitar tudo. */
      totalDue: number;
      received: number;
      /** Quanto o título baixa (principal dos meios + desconto). */
      settled: number;
      remaining: number;
      /** Troco devolvido em dinheiro. */
      change: number;
      /** Dinheiro a mais que vira crédito na carteira. */
      walletCredit: number;
      /** De qual linha saiu o troco ou o crédito (-1 se não houve). */
      excessLine: number;
    }
  | { ok: false; message: string };

const inteiro = (v: number | undefined) => Math.max(0, Math.round(v ?? 0));

export function planSettlement(input: PlanInput): Plan {
  const open = inteiro(input.open);
  const discount = inteiro(input.discount);
  const surcharge = inteiro(input.surcharge);
  const interest = inteiro(input.interest);
  const fine = inteiro(input.fine);
  if (open <= 0) return { ok: false, message: 'Esta conta não tem valor em aberto.' };
  if (input.lines.length === 0) return { ok: false, message: 'Informe ao menos um meio de pagamento.' };
  if (input.lines.some((l) => !Number.isInteger(l.amount) || l.amount <= 0)) return { ok: false, message: 'Cada meio de pagamento precisa de um valor maior que zero.' };
  if (discount > open) return { ok: false, message: 'O desconto não pode ser maior que o valor em aberto.' };

  const totalDue = open - discount + surcharge + interest + fine;
  const received = input.lines.reduce((s, l) => s + l.amount, 0);
  const kept = input.lines.map((l) => l.amount);

  let change = 0;
  let walletCredit = 0;
  let excessLine = -1;
  const sobra = received - totalDue;
  if (sobra > 0) {
    // A sobra sai do meio em dinheiro que a comporta (o maior, se houver mais de um).
    excessLine = input.lines.reduce((best, l, i) => (l.isCash && l.amount >= sobra && (best < 0 || l.amount > input.lines[best].amount) ? i : best), -1);
    if (excessLine < 0) return { ok: false, message: 'O valor passa do que falta. Só dá para receber a mais em dinheiro, que volta de troco.' };
    if (input.change === 'WALLET') {
      if (!input.walletAvailable) return { ok: false, message: 'Só paciente tem carteira. Devolva o troco.' };
      walletCredit = sobra;
    } else {
      change = sobra;
    }
    kept[excessLine] -= sobra;
  }

  // Juros, multa e acréscimo saem primeiro do que foi recebido; o resto é principal.
  let faltaMulta = fine;
  let faltaJuros = interest;
  let faltaAcrescimo = surcharge;
  const lines: PlannedLine[] = kept.map((k) => {
    let resto = k;
    const pega = (falta: number) => {
      const v = Math.min(resto, falta);
      resto -= v;
      return v;
    };
    const f = pega(faltaMulta);
    faltaMulta -= f;
    const j = pega(faltaJuros);
    faltaJuros -= j;
    const a = pega(faltaAcrescimo);
    faltaAcrescimo -= a;
    return { kept: k, principal: resto, discount: 0, surcharge: a, interest: j, fine: f };
  });
  if (faltaMulta + faltaJuros + faltaAcrescimo > 0) return { ok: false, message: 'O valor recebido não cobre nem os juros, a multa e o acréscimo.' };

  const principalTotal = lines.reduce((s, l) => s + l.principal, 0);
  if (principalTotal + discount <= 0) return { ok: false, message: 'O valor recebido não abate nada da conta.' };
  // O desconto fica registrado no primeiro meio que abate o título (ou no primeiro, se nenhum abate).
  const comDesconto = Math.max(0, lines.findIndex((l) => l.principal > 0));
  lines[comDesconto].discount = discount;

  const settled = principalTotal + discount;
  if (settled > open) return { ok: false, message: 'O valor passa do que falta receber.' };
  return { ok: true, lines, totalDue, received, settled, remaining: open - settled, change, walletCredit, excessLine };
}

/** Desconto em % do valor em aberto (para conferir com o limite de quem opera). */
export const discountPercent = (discountCents: number, openCents: number): number => (openCents > 0 ? (discountCents / openCents) * 100 : 0);
