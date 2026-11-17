# Financeiro completo: plano em fases

Spec: `docs/specs/2026-11-16-financeiro-completo.md`. Uma branch e um PR por fase, nesta ordem. Cada fase entra atrás da bandeira (`financeEnabled`).

## F1. Fundação (`feat/financeiro-f1-fundacao`)
- Schema: contas, categorias, centros de custo, formas e taxas, contatos, títulos, rateio, movimentos, recebíveis de cartão, caixa, carteira, renegociação, recorrência, itens do agendamento, permissões por usuário, anexos; `Appointment.billingStatus`/`noChargeReason`.
- `lib/financeiro/` puro e testado: `money`, `installments` (parcelas com arredondamento), `interest` (juros e multa), `title-status`, `allocation` (rateio), `card` (taxa e compensação), `balance` (conta e carteira), `dre`, `defaults` (plano de contas e formas padrão), `settings` (`Tenant.settings.finance`).
- `lib/financeiro/flag.ts`, capacidades novas em `lib/permissions.ts`, `fin/guard.ts` (perfil + permissão por usuário).
- `fin/setup.ts`: `ensureFinanceSetup` (contas, categorias e formas padrão; importa `settings.paymentMethods`).
- Configurações › Financeiro: Contas, Categorias, Centros de custo, Formas de recebimento e pagamento, Clientes e fornecedores, Regras gerais, Permissões financeiras.
- SQL: `docs/producao/2026-11-16-financeiro-f1.sql` (só cria).

## F2. Contas e movimentos (`feat/financeiro-f2-contas`)
- `fin/titles.ts` (criar, parcelar, recorrência, editar, cancelar), `fin/settle.ts` (receber/pagar com vários meios, trava de linha, troco, carteira), `fin/reverse.ts` (estorno).
- Telas: Contas (abas, filtros em chips, baixa em lote, CSV), Novo título, tela de recebimento, Movimentações, Estornos, anexos.
- Recibo novo (A4 e cupom 80 mm) e envio pelo WhatsApp; `/financeiro/recibo/[id]` continua valendo.
- Migração por clínica: títulos dos orçamentos aprovados e cópia dos `Payment` (`legacyPaymentId`), espelho do pagamento.
- Orçamento: aprovar gera títulos; "Registrar pagamento" usa a tela nova.

## F3. Caixa (`feat/financeiro-f3-caixa`)
Abrir, reforço, sangria (com transferência), exigir caixa aberto para dinheiro, fechar com conferência (cega ou não), diferença com justificativa, relatório em PDF, caixas fechados, fechar o caixa de outra pessoa, avisos.

## F4. Agenda (`feat/financeiro-f4-agenda`)
Itens do agendamento e "Trazer do orçamento", situação financeira e cifrão no card, aba Financeiro com Receber/Faturar/Não cobrar, "Receber agora" ao concluir, bloqueio opcional, faturar sozinho, tela A faturar, aba Financeiro da ficha, Retorno lendo dos títulos, aviso no fechamento do caixa, evento `payment.received`.

## F5. Carteira, renegociação e transferências (`feat/financeiro-f5-carteira`)

## F6. Comissões e repasses (`feat/financeiro-f6-comissoes`)
Tabelas `commission_rules`, `commission_exceptions`, `transfer_types`, `commission_entries`; `Procedure.costPrice`.

## F7. Cartões e conciliações (`feat/financeiro-f7-conciliacao`)
Tabelas `bank_statement_imports`, `bank_statement_lines`. OFX, CSV de cartões, antecipação, cheque devolvido.

## F8. Relatórios (`feat/financeiro-f8-relatorios`)
Visão geral nova, fluxo de caixa, DRE, financeiro geral, inadimplência, centros de custo, procedimentos faturados, caixas, exportações.

## F9. Régua de cobrança (`feat/financeiro-f9-regua`)
Tabelas `collection_rules`, `collection_dispatches`; modelos novos na Meta; roda no cron de lembretes.

## Testes obrigatórios (onde entram)

| Caso | Fase |
| --- | --- |
| Isolamento entre clínicas | F1 em diante |
| R$ 1.000 em 3x = 333,33 + 333,33 + 333,34 | F1 |
| Juros e multa (R$ 500, 10 dias, 2% + 0,033% ao dia) | F1 |
| Taxa de cartão em 3x: líquido e compensação por parcela | F1 |
| Baixa parcial vira PARCIAL; o resto vira PAGO | F2 |
| Dois recebimentos ao mesmo tempo: um passa, o outro é recusado | F2 |
| Não recebe mais que o em aberto; sobra vira troco ou carteira | F2 |
| Desconto acima do limite recusado no servidor | F2 |
| Estorno reabre o título e não altera caixa fechado | F2/F3 |
| Conta em só leitura não grava | F2 |
| Orçamentos antigos migrados mostram os mesmos valores | F2 |
| Caixa não fecha com dinheiro negativo; aviso de atendido sem faturar | F3/F4 |
| Item coberto por orçamento não gera título; cortesia fora do A faturar | F4 |
| Renegociação marca, cria e desfaz | F5 |
| Estorno estorna a comissão proporcional | F6 |
| DRE bate com as categorias; fluxo bate com os movimentos | F8 |

## Antes de cada push
`npx next lint` (sem "Error"), `npx vitest run`, `npx next build` em `apps/web` e `pnpm typecheck` na raiz.
