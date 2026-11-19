# Plano: paciente e agenda

Spec: `docs/specs/2026-11-18-paciente-e-agenda.md`. Branches empilhadas: `feat/paciente-f1-cadastro` → `feat/paciente-f2-perfil` → `feat/paciente-f3-documentos` → `feat/agenda-f4-nucleo` → `feat/agenda-f5-visualizacoes` → `feat/agenda-f6-operacao` → `feat/agenda-f7-escalas` → `feat/agenda-f8-relatorios`. PRs na ordem.

Em cada fase: schema → `pnpm db:push` no `clinicaiq_dev` → SQL em `docs/producao/2026-11-18-<fase>.sql` (só acréscimos, RLS ligado) → regras puras com teste → servidor → telas → `next lint`, `pnpm typecheck`, testes, `next build` → push → rodar o SQL na produção e conferir.

## F1 cadastro
1. Bandeira `lib/feature-flags.ts` e capacidades novas em `lib/permissions.ts` (+ teste).
2. Schema: colunas do paciente, `patient_origins`, `patient_insurances`, `patient_custom_fields`.
3. Puro: `lib/patient-name.ts` (`displayName`, `officialName`), `lib/patient-fields.ts` (obrigatórios, informações adicionais: validar, montar alertas), `lib/patient-filters.ts` (filtros da lista pela URL), `lib/birthdays.ts`.
4. Servidor: `pacientes/actions.ts` lê e grava os campos novos (só com a bandeira), `checkCpfAction` (CPF primeiro), `pacientes/settings-actions.ts` (origens, campos, obrigatórios), exportar CSV (`/pacientes/exportar`).
5. Telas: formulário em abas, passo do CPF, lista com filtros, aniversariantes, Configurações › Pacientes, Ctrl+K.

## F2 perfil
1. Schema: `patient_events`, `patient_notes.pinned/showInAgenda`, `treatment_plans`, `treatment_plan_items`.
2. Puro: `lib/attendance.ts`, `lib/patient-events.ts` (rótulos, ícones, filtro).
3. Servidor: `lib/patient-timeline.ts` (`recordPatientEvent` com `after`), backfill, ações de notas, planos, convênios, foto.
4. Telas: cabeçalho, grupos de abas, visão geral, histórico, linha do tempo, conversas, ficha e cartão (PDF em `packages/pdf`).

## F3 documentos
1. Schema das tabelas de documento, assinatura, pasta, envio pelo celular e questionário.
2. Puro: `lib/doc-template.ts` (variáveis, limpar HTML), `lib/signature.ts` (hash, situação), `lib/questionnaire.ts`.
3. Rotas públicas `/assinar/[token]`, `/enviar/[token]`, `/questionario/[token]` (com limite de uso, sem gravar ao abrir).
4. Telas no perfil e em Configurações › Atendimento.

## F4 núcleo da agenda
1. Schema e SQL (agendas por profissional, sem mexer nos dados de hoje).
2. Puro: `lib/recurrence.ts`, `lib/holidays.ts`, `lib/appointment-status.ts` (rótulos e origem da confirmação), `lib/booking-checks.ts`.
3. Servidor: ações novas de agendar, remarcar, cancelar com motivo, excluir, situação com histórico, série, compromissos.
4. Telas: janelas de criar e de detalhes, configurações (agendas, tipos, motivos, feriados).
5. WhatsApp: botão Confirmar grava a origem; Cancelar grava "pelo paciente".

## F5 visualizações
Modos, filtros lembrados, mini calendário, busca na agenda, selos, impressão.

## F6 operação
Confirmações, lista de espera com oferta, horários livres, alterações em massa, meu dia.

## F7 escalas
`schedule_rules`, `schedule_exceptions`, `lib/schedule-rules.ts`, migração do expediente, leitura na agenda e no online.

## F8 relatórios
`/relatorios/agenda/*` com CSV e XLSX.

Ao fim de cada fase: mensagem ao dono e atualização do Notion (guia de telas, passo a passo, arquitetura).
