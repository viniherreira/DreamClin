# Paciente e agenda no nível do Clínica nas Nuvens

Data: 18/11/2026. Pedido do dono: levar o cadastro, o perfil do paciente e a agenda ao nível da referência de gestão (Clínica nas Nuvens), sem copiar textos, nomes de tela nem a marca. Fases F1 a F8, uma branch e um PR por fase, empilhadas (cada uma parte da anterior).

## O que já existe e fica

- Paciente: `controlNumber` sequencial por clínica (já preenchido em todos), CPF e telefones cifrados, `cpfHash` (índice cego, `lib/cpf-hash.ts`), nota da equipe (`PatientNote`), anamnese (uma por paciente, JSON), evoluções, imagens (`PatientFile` no Supabase Storage), financeiro (antigo e o novo atrás de bandeira), LGPD (exportar, anonimizar, registro de quem abriu).
- Ficha em `/pacientes/[id]` com abas por `?aba=` (`record-tabs.tsx`).
- Agenda por profissional (dia, semana, mês), arrastar, sala de espera, rótulos, bloqueio, regras (`Tenant.settings.agenda`), unidades, agendamento online, itens e cobrança do financeiro novo (`fin/agenda-bridge.ts`).
- O dia do paciente: situações SCHEDULED, CONFIRMED, RESCHEDULED, CANCELLED, ATTENDED, MISSED; chegada, início e fim são horas (`arrivedAt`, `startedAt`, `finishedAt`). Esta decisão continua: nada de situação nova para "chegou" ou "em atendimento".
- WhatsApp oficial com confirmação e lembrete com botões; o CRM recebe avisos por `after(() => notifyCrm(...))`.

## Decisões de adaptação (o que muda em relação ao pedido)

1. **Bandeira única** `lib/feature-flags.ts` → `pacienteAgendaEnabled(tenantId)`: liga na conta em cortesia ou para todos com `PACIENTE_AGENDA=todos` na Vercel. Desligada, as telas antigas continuam iguais. As colunas novas são todas opcionais, então os caminhos antigos não quebram.
2. **Sexo e gênero:** a coluna `gender` de hoje (M/F/O/N) passa a ser mostrada como "Sexo". O gênero (opcional, texto livre) é coluna nova `genderIdentity`.
3. **"Como prefere ser chamado"** (`nickname`) continua. O **nome social** é coluna nova `socialName`; quando preenchida é o nome de tela e das mensagens (`displayName()` em `lib/patient-name.ts`), e o nome civil sai só em documentos oficiais (recibo, contrato, atestado, receita).
4. **Documentos pessoais cifrados:** RG, passaporte/documento de estrangeiro e CNS são dado pessoal e vão cifrados como o CPF (`rgEncrypted`, `foreignDocEncrypted`, `cnsEncrypted`).
5. **Número de controle:** já existe e está preenchido. Passa a ser editável (único na clínica; o sistema avisa se repetir).
6. **Confirmado pelo paciente** não é situação nova: é CONFIRMED com `confirmationSource` WHATSAPP ou LINK (a tela escreve "Confirmado pelo paciente"). Recepção e telefone gravam RECEPTION e PHONE. Relatórios e CRM seguem lendo CONFIRMED.
7. **Remarcar** muda o mesmo agendamento de lugar (os itens, a cobrança e a conversa continuam presos nele) e grava uma linha em `appointment_reschedules` (de quando, para quando, profissional de antes e de depois, quem, motivo, origem). A aba Remarcações e o contador por paciente leem essa tabela. A situação RESCHEDULED deixa de ser usada pelas telas novas (antigos continuam aparecendo).
8. **Profissional continua obrigatório no agendamento** na F4. Lembretes, comissões, CRM e relatórios dependem dele; a agenda de recurso (sala, equipamento, canal) é um campo a mais (`agendaId`). Quando a agenda é só um recurso, a tela sugere o profissional padrão da agenda.
9. **Feriados nacionais** são calculados por função pura (fixos e os da Páscoa), não gravados. A tabela `holidays` guarda os municipais e os dias que a clínica quiser marcar.
10. **Escala** nova (`schedule_rules`) com `tenantId` (a tabela antiga `professional_schedules` não tem). Enquanto o profissional não tiver escala nova, vale o expediente antigo, então ninguém perde horário.
11. **Linha do tempo** em tabela própria (`patient_events`), gravada nas ações com `after()`. A F2 preenche o passado que dá para reconstruir (cadastro, agendamentos, orçamentos, evoluções, pagamentos).
12. **Modelos novos do WhatsApp** (questionário, abriu um horário, remarcação, documento para assinar) ficam salvos e só vão para a Meta quando o dono clicar, como a régua de cobrança. Até aprovar, a função mostra "aguardando a Meta" e oferece o link para copiar e mandar à mão.
13. **Etnia/raça:** não entra.
14. **Profissional limitado à própria agenda:** regra da clínica `professionalOwnAgendaOnly` (padrão desligada).

## Perfis e permissões

Capacidades novas em `lib/permissions.ts`:

| Capacidade | Dono | Admin | Recepção | Profissional |
|---|---|---|---|---|
| `pacientes_exportar` (lista e ficha) | sim | sim | se a clínica liberar | não |
| `agenda_excluir` (excluir agendamento lançado por engano) | sim | sim | não | não |
| `agenda_massa` (alterações em massa) | sim | sim | não | não |
| `anexos_apagar` | sim | sim | não | só os próprios |
| `agenda_config` (escalas, tipos, agendas, motivos, feriados) | sim | sim | sim | não |

Documento clínico, questionário de saúde e foto clínica seguem `prontuario` e gravam o acesso. LGPD continua em `privacidade`.

## F1 — Cadastro do paciente

Colunas novas em `patients` (todas opcionais): `socialName`, `genderIdentity`, `rgEncrypted`, `rgIssuer`, `foreigner`, `nationality`, `foreignDocEncrypted`, `landlineEncrypted`, `landlineExt`, `otherContacts` (JSON: tipo e número, cifrado por item), `cnsEncrypted`, `bloodType`, `spouseName`, `motherName`, `fatherName`, `legalGuardian`, `financialResponsibleId` (outro paciente) e `financialResponsibleText`, `priority` (booleano) e `priorityType`, `education`, `hobby`, `referredById` (paciente que indicou; `referredBy` continua como texto), `originId`, `birthdayMessages` (padrão sim), `photoPath`, `customFields` (JSON `{ campoId: { v, obs } }`).

Tabelas novas: `patient_origins` (lista da clínica; as padrão nascem sozinhas), `patient_insurances` (plano, carteirinha, validade, situação; o plano é um `FinContact` do tipo convênio quando o financeiro novo está ligado, senão texto), `patient_custom_fields` (tipo, opções, obrigatório, tem observação, destacar, ordem, ativo).

Telas:
- Formulário em 4 abas (Dados do paciente, Comercial e financeiro, Dados complementares, Marketing) mais as informações adicionais. Só nome, nascimento e celular obrigatórios; a clínica escolhe outros em Configurações › Pacientes › Campos obrigatórios.
- "CPF primeiro": ao criar, um passo antes do formulário pergunta o CPF, com "Preencher depois". CPF já cadastrado abre o cadastro existente.
- CEP: busca o endereço; se falhar, deixa digitar (já é assim, só ganha aviso).
- Lista com busca rápida (nome, CPF, telefone, número de controle) e filtros (sexo, nascimento de/até, cidade, e-mail, convênio, atendido por, situação, origem, com ou sem agendamento futuro, unidade), colunas novas e ações (perfil, editar, agendar). Exportar CSV com `pacientes_exportar` e auditoria.
- `/pacientes/aniversariantes` por dia, semana ou mês, com "Mandar parabéns" (usa o modelo de aniversário que já existe; respeita `birthdayMessages`).
- Busca no topo: Ctrl+K abre, mostra os últimos abertos (no navegador) e acha pelo responsável financeiro.
- Configurações › Pacientes: campos obrigatórios, informações adicionais (com pré-visualização), origens.

## F2 — Perfil do paciente

- Cabeçalho fixo: foto (enviar ou câmera), nome de tela, idade, número, situação, selos (prioritário, convênio, devendo), alertas (anamnese crítica + respostas destacadas), telefone com "Chamar no WhatsApp" (conversa do CRM se a clínica tem o módulo; senão wa.me), último atendimento e próximo agendamento. Botões Agendar, Editar e Mais (ficha, cartão, exportar LGPD, anonimizar, inativar).
- Abas agrupadas por um seletor de grupo (Resumo, Clínico, Agenda, Financeiro, Comercial, Documentos, Relacionamento, Cadastro), mantendo `?aba=`. Clínico com cadeado para quem não tem `prontuario`.
- Visão geral em cartões: dados, informações adicionais, próximos agendamentos com ações rápidas, lista de espera (F6 liga), últimos atendimentos, últimos documentos (F3 liga), financeiro resumido, comparecimento (`lib/attendance.ts`, puro).
- Histórico de agendamentos com os 4 totais e a tabela.
- Linha do tempo (`patient_events`), filtro por tipo e "Ver mais".
- Observações: fixar, "aparece na agenda", editar a própria.
- Conversas do CRM (só com o módulo; lido por uma função do CRM chamada pela página, sem a agenda importar regra do CRM).
- Convênios do paciente, planos de tratamento (`treatment_plans`, `treatment_plan_items`, nascem do odontograma ou avulsos; progresso; virar orçamento).
- Ficha do paciente em PDF, XLSX ou CSV (opções de cabeçalho, rodapé, título e linhas no fim) e cartão do paciente (PDF tamanho cartão com QR do agendamento online).

## F3 — Documentos

Tabelas: `document_templates`, `patient_documents`, `signature_requests`, `patient_folders`, `folder_templates` (guardado em `Tenant.settings.patients.folders`), `upload_sessions`, `questionnaires`, `questionnaire_questions`, `questionnaire_requests`, `questionnaire_answers`. `patient_files` ganha `folderId`, `appointmentId`, `clinical`.

- Modelos com editor simples (negrito, itálico, listas, tabela, tamanho e cor) e variáveis `{paciente}`, `{cpf}`, `{nascimento}`, `{idade}`, `{endereco}`, `{data}`, `{hora}`, `{profissional}`, `{registro_profissional}`, `{clinica}`, `{cidade}`, `{procedimento}`, `{dias}` e `{campo:Nome}`. HTML guardado limpo (lista fixa de marcas permitidas).
- Documento avulso e clínico, PDF A4 com cabeçalho e rodapé da clínica e assinatura do profissional.
- Assinatura por link (`/assinar/[token]`): abrir não grava nada; a pessoa confere nome e CPF, desenha ou aceita; grava data, hora, IP, aparelho e hash do PDF; o PDF final ganha a página de comprovação.
- Anexos com pastas, padrão de pastas da clínica, arrastar vários, limite por arquivo (padrão 50 MB), câmera, "Enviar pelo celular" (QR para `/enviar/[token]`, 15 minutos, um paciente e uma pasta).
- Questionários por link (`/questionario/[token]`) e WhatsApp; respostas de saúde entram na anamnese marcadas "respondido pelo paciente".

## F4 — Núcleo da agenda

Tabelas: `agenda_resources`, `care_types`, `cancel_reasons`, `holidays`, `appointment_status_changes`, `appointment_reschedules`, `appointment_series`. Colunas em `appointments`: `agendaId`, `careTypeId`, `confirmationSource`, `preCareAt`, `cancelledBy`, `cancelReasonId`, `origin`, `referringProfessional`, `seriesId`, `seriesIndex`, `needsPreCare`, `notifyWhatsapp`, `notifyEmail`, `specialty`. Em `blocked_slots`: `seriesId`, `color`, `blocksBooking` (padrão sim), `agendaId`, `allAgendas`, `unitId`, e `professionalId` passa a aceitar nulo (só tira a obrigatoriedade; nenhum dado muda).

- Uma agenda por profissional criada sozinha (SQL que só acrescenta) e ligada aos agendamentos antigos dele.
- Janela de criar em abas (Agendamento, Procedimentos, Repetição, Outras opções), com os avisos: mesmo dia, conflito no profissional e na agenda, fora da escala, data no passado, convênio vencido.
- Janela de detalhes com abas Detalhes (situação por lista, linha do tempo das situações), Financeiro, Comissões, Remarcações, Histórico do paciente, Auditoria.
- Cancelar com quem cancelou e motivo (lista cadastrável); excluir só dono/admin; repetidos com "só este / este e os próximos / todos" sem mexer nos atendidos.
- Compromissos repetidos e "bloqueia ou só lembrete"; feriados.

## F5 — Visualizações

Modos profissionais, agendas lado a lado, agendas juntas e listas (por horário, profissional, paciente); filtros lembrados por usuário (navegador); mini calendário com dias marcados; busca de paciente na agenda; selos no card; imprimir o dia e e-mail do dia ao profissional (no cron de lembretes, se houver e-mail configurado).

## F6 — Operação

`/agenda/confirmacoes`, `/agenda/lista-de-espera` (`waitlist_entries`, `waitlist_offers`), `/agenda/horarios-livres` (a mesma função do agendamento online), `/agenda/alteracoes` (em lote, transação, auditoria, só `agenda_massa`), `/agenda/meu-dia`.

## F7 — Escalas

`schedule_rules` (profissional, unidade, tipo de atendimento ou todos, vigência, repetição semanal/quinzenal/a cada N dias/dia do mês, dias da semana, até 2 períodos) e `schedule_exceptions` (folga ou plantão). Função pura `lib/schedule-rules.ts` responde "qual o expediente deste profissional neste dia". Choque ao salvar pergunta "manter" ou "substituir". O expediente antigo vira escala sem fim (SQL que só acrescenta). Agenda, horários livres e agendamento online passam a ler daqui.

## F8 — Relatórios

`/relatorios/agenda/*`: por situação, por data de criação (quem marcou), por origem e por origem da confirmação, por convênio/agenda/tipo/procedimento, por cidade e bairro, pacientes sem agendar, remarcações, lista de espera, cadastro de pacientes, aniversariantes, respostas das informações adicionais, ocupação da agenda. CSV e XLSX (`lib/xlsx.ts`).

## CRM

Eventos novos no `ClinicEvent`: `appointment.confirmed_by_patient`, `appointment.cancelled` com `by`, `appointment.missed`, `patient.waitlisted`, `questionnaire.answered`. Só `after(() => notifyCrm(...))`. A origem do lead vira a origem do paciente (`originId` pela origem "WhatsApp" ou a do anúncio) quando o paciente herda o lead.

## Testes obrigatórios

Os do pedido (seção 17), com Vitest para as funções puras (recorrência, horários livres, escalas, comparecimento, feriados, variáveis de documento), `*.db.test.ts` para isolamento entre clínicas, CPF repetido, cancelar "este e os próximos", remarcação, alteração em massa, oferta da lista de espera, links que não gravam ao abrir, e conta em só leitura.

## Fica para depois

Guias TISS, telemedicina, estoque, ICP-Brasil, SMS e e-mail marketing, Memed, profissional opcional em agendamento de recurso.
