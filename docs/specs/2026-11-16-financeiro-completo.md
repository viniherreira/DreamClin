# Financeiro completo: especificação

Data: 16/11/2026. Referência de funcionalidade: o financeiro do Clínica nas Nuvens. Textos e nomes de tela são nossos.

## 1. O que existe hoje (lido no código)

- **Dinheiro:** `Decimal(10,2)` no banco, `number` com `round2` nas contas.
- **Orçamento:** `Quote` (total, entrada `downPayment`, `installments`, `paymentMethod`) e `QuoteItem` (sem `tenantId`). O plano de parcelas não é gravado: sai na hora de `lib/payment-schedule.ts` (entrada no dia da aprovação, parcelas mês a mês, o recebido cobre em ordem).
- **Pagamento:** `Payment` (paciente, orçamento opcional, valor, forma em texto, `paidAt`). É apagado de verdade ao excluir (`deleteQuotePayment`), sem estorno.
- **Quem lê `Payment`:** dashboard, `/financeiro` (resumo e detalhamento), lista e detalhe de orçamentos, ficha do paciente, janela do agendamento, Retorno (fila "Devendo"), exportação LGPD e o recibo (`/financeiro/recibo/[id]`).
- **Agendamento:** um procedimento só (`Appointment.procedureId`), sem preço próprio; a "produção" usa o preço-base do procedimento. `Appointment.type` já tem PARTICULAR, CONVENIO e CORTESIA.
- **Comissão:** `Professional.commissionPercent` × produção, calculada na tela.
- **Formas de recebimento:** lista de textos em `Tenant.settings.paymentMethods`.
- **Permissão:** uma capacidade só, `financeiro`, para os quatro perfis.
- **Cortesia:** `Subscription.complimentary` identifica a conta do dono.

## 2. Decisões de adaptação

1. **Bandeira de novidade.** O financeiro novo aparece só quando `financeEnabled(tenantId)` é verdadeiro: conta em cortesia, ou a variável `FINANCEIRO_COMPLETO=todos` na Vercel (o "liberar para todos"). Com a bandeira desligada, nada muda para a clínica: telas, ações e dados antigos seguem iguais.
2. **Dinheiro.** Colunas novas em `Decimal(12,2)`. Toda conta é feita em centavos inteiros nas funções puras de `lib/financeiro/` (`money.ts` converte na entrada e na saída).
3. **Datas.** Vencimento, emissão, pagamento e compensação são `DATE` (sem hora). Competência é texto `AAAA-MM`.
4. **Preenchimento por clínica, no código.** O SQL de produção só cria tabelas e colunas. Contas, categorias e formas padrão, os títulos dos orçamentos aprovados e a cópia dos `Payment` antigos são feitos por `ensureFinanceSetup(tenantId)` na primeira vez que a clínica abre o financeiro novo (mesmo jeito da "unidade principal"). É idempotente, roda numa transação e tem teste contra o banco local. Vantagem: nenhuma clínica real é tocada enquanto a bandeira dela estiver desligada, e a migração é a mesma na liberação geral.
5. **Espelho do pagamento antigo.** Enquanto houver telas antigas lendo `Payment`, todo recebimento de título de paciente grava também um `Payment` espelho (e o estorno o remove), na mesma transação. Assim dashboard, Retorno, orçamentos e exportação LGPD continuam certos sem mexer neles. A fonte da verdade da clínica com a bandeira ligada são os títulos e os movimentos. Crédito colocado na carteira não vira espelho (não é pagamento de dívida); usar a carteira para quitar um título vira.
6. **Itens do agendamento.** Tabela nova `appointment_items`. `Appointment.procedureId` continua preenchido com o primeiro item, então lembretes, Retorno, CRM e relatórios antigos não mudam.
7. **Permissões.** A capacidade `financeiro` fica como está (não tira acesso de ninguém nas telas antigas). O módulo novo usa capacidades próprias (`fin_ver`, `fin_receber`, `fin_pagar`, `fin_caixa`, `fin_caixas_outros`, `fin_estornar`, `fin_renegociar`, `fin_comissoes`, `fin_comissoes_proprias`, `fin_relatorios`, `fin_config`) e, por cima, `FinancialPermission` por usuário.
8. **Liberação na hora.** No lugar de senha compartilhada, "Pedir liberação" cria um pedido que o dono ou administrador aprova na tela dele (Financeiro › Liberações). Entra na F2 junto com o desconto.
9. **Rotinas.** Recorrência, aviso de caixa aberto e régua de cobrança entram no cron de lembretes (9 h de Brasília). Nada de cron novo na Vercel.
10. **CRM.** Evento novo `payment.received` em `ClinicEvent`, enviado com `after(() => notifyCrm(...))`. A agenda e os orçamentos continuam sem importar nada do CRM além disso.

## 3. Conceitos

| Conceito | Tabela | Regra |
| --- | --- | --- |
| Conta | `financial_accounts` | Caixa interno, banco ou digital. Saldo = saldo inicial + soma dos movimentos (nunca guardado). |
| Categoria | `financial_categories` | Dois níveis, Receber ou Pagar, linha da DRE na subcategoria. Em uso não se apaga. |
| Centro de custo | `cost_centers` | Dois níveis, opcional. |
| Cliente/Fornecedor | `fin_contacts` | Paciente já é cliente. CPF/CNPJ cifrado com índice cego. |
| Forma | `fin_payment_methods` + `fin_payment_method_fees` | Tipo do documento, conta de destino, compensação, taxas do cartão por faixa de parcelas. |
| Título | `financial_titles` | A cobrança ("faturar"). Situação gravada: ABERTO, PARCIAL, PAGO, CANCELADO, RENEGOCIADO. Vencido é calculado. |
| Movimento | `financial_transactions` | Dinheiro que entrou ou saiu ("baixar"). Estorno cria outro movimento, nunca apaga. |
| Caixa | `cash_sessions` + `cash_session_counts` | Sessão por usuário e unidade. |
| Carteira | `wallet_entries` | Crédito do paciente. Saldo = soma das linhas. |
| Renegociação | `renegotiations` + `renegotiation_titles` | Antigos viram RENEGOCIADO, nascem os novos. |

**Valores do movimento.** `amount` é o dinheiro que andou. `principal` é quanto do título ele quita: `principal = amount + desconto − acréscimo − juros − multa`. O título guarda `paidAmount` (soma dos `principal` não estornados); em aberto = `amount − paidAmount`.

**Receber num passo só.** A ação principal é "Receber": cria o título (quando ainda não existe) e os movimentos juntos. "Faturar" cria só o título.

**Concorrência.** A baixa relê o título com `SELECT ... FOR UPDATE` dentro da transação e recusa se o em aberto mudou.

## 4. Telas

| Tela | Endereço | Fase |
| --- | --- | --- |
| Configurações › Financeiro (contas, categorias, centros de custo, formas, clientes e fornecedores, regras, permissões) | `/configuracoes#fin-*` | F1 |
| Contas a receber e a pagar | `/financeiro/contas` | F2 |
| Movimentações | `/financeiro/movimentacoes` | F2 |
| Estornos | `/financeiro/estornos` | F2 |
| Caixa e caixas fechados | `/financeiro/caixa`, `/financeiro/caixa/fechados` | F3 |
| A faturar | `/financeiro/a-faturar` | F4 |
| Carteiras, Renegociações, Transferências | `/financeiro/carteiras`, `/renegociacoes`, `/transferencias` | F5 |
| Comissões | `/financeiro/comissoes` | F6 |
| Conciliação | `/financeiro/conciliacao/bancos`, `/cartoes` | F7 |
| Visão geral e relatórios | `/financeiro`, `/financeiro/relatorios/...` | F8 |
| Régua de cobrança | Configurações › Financeiro | F9 |

O menu "Financeiro" da clínica ganha os itens novos só com a bandeira ligada.

## 5. Planos

- Todo plano com Agenda: caixa, contas, receber na agenda, A faturar, recibo, carteira, renegociação, transferências, visão geral simples, comissão por regra simples.
- Profissional e Clínica (`advancedReports`): DRE, fluxo de caixa, centros de custo e rateio, conciliações, régua de cobrança, exceções e repasses de comissão, exportação XLSX.
- Clínica só com CRM não vê o financeiro.
- O que não está no plano aparece com cadeado e "Disponível no plano Profissional".

## 6. Segurança e auditoria

- Tabelas novas com `tenantId` e RLS ligado. Acesso só por `getTenantClient(tenantId)`.
- Toda ação: `writeBlocked` (conta em só leitura não grava), capacidade do perfil e `FinancialPermission`.
- Estorno, cancelamento, desconto liberado, caixa fechado por outra pessoa e mudança de procedimento depois de atendido gravam `AuditLog`.

## 7. Critérios de aceite

Os 17 casos do pedido viram testes (unitários para as contas puras, `*.db.test.ts` para as regras com banco, Playwright para os fluxos). Lista em `docs/planos/2026-11-16-financeiro-completo.md`.

## 8. Fica para depois

Link de pagamento, PIX com QR e boleto emitidos pelo sistema, NFS-e, TISS, split fiscal e estoque. O título já guarda `document` e `documentNumber`, e o movimento guarda `nsu`, para encaixar um gateway depois sem mudar tabela.
