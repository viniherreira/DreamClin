import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envFile = resolve(__dirname, '..', '.env.local');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.ENCRYPTION_MASTER_KEY ??= 'unit-test-master-key-not-a-real-secret';

describe.skipIf(!process.env.DATABASE_URL)('financeiro: agendamento com itens, faturar, receber e não cobrar (banco)', async () => {
  const { prisma, getTenantClient, encrypt } = await import('@clinicaiq/db');
  const { setupFinance, methodId } = await import('./setup');
  const { settleTitleTx } = await import('./settle');
  const { reverseTransactionTx } = await import('./reverse');
  const { cancelTitle } = await import('./titles');
  const appt = await import('./appointments');
  const { refreshBillingTx } = await import('./billing-sync');
  const { DEFAULT_FINANCE_SETTINGS } = await import('../lib/financeiro/settings');
  const { toCents } = await import('../lib/financeiro/money');

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const HOJE = '2026-11-17';
  const chave = process.env.ENCRYPTION_MASTER_KEY!;

  const novaClinica = async (nome: string) => {
    const t = await prisma.tenant.create({ data: { clerkOrgId: `ag_${nome}_${suffix}`, name: `Agenda ${nome}`, slug: `ag-${nome}-${suffix}` } });
    await setupFinance(t.id);
    const dono = await prisma.user.create({ data: { tenantId: t.id, clerkUserId: `ag_dono_${nome}_${suffix}`, name: 'Dono', email: `ag-dono-${nome}-${suffix}@teste.local`, role: 'OWNER' } });
    const prof = await prisma.professional.create({ data: { tenantId: t.id, name: 'Dra. Agenda' } });
    const limpeza = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Limpeza', basePrice: 200, durationMinutes: 30 } });
    const consulta = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Consulta', basePrice: 150, durationMinutes: 30 } });
    const gratis = await prisma.procedure.create({ data: { tenantId: t.id, name: 'Retorno', basePrice: 0, durationMinutes: 15 } });
    const convenio = await prisma.finContact.create({ data: { tenantId: t.id, name: 'Convênio Saúde', kind: 'INSURANCE', personType: 'PJ' } });
    let n = 0;
    const paciente = async (name: string) => prisma.patient.create({ data: { tenantId: t.id, controlNumber: ++n, name, phoneEncrypted: encrypt(`1199999${String(1000 + n)}`, chave, t.id) } });
    let vez = 0;
    // Um horário a cada 15 minutos, todos no mesmo dia.
    const agendar = async (patientId: string, procedureId: string | null, extra: object = {}) => {
      const inicio = Date.parse(`${HOJE}T06:00:00.000Z`) + vez++ * 15 * 60_000;
      return prisma.appointment.create({ data: { tenantId: t.id, patientId, professionalId: prof.id, procedureId, startTime: new Date(inicio), endTime: new Date(inicio + 15 * 60_000), ...extra } });
    };
    return { id: t.id, db: getTenantClient(t.id), dono, prof, limpeza, consulta, gratis, convenio, paciente, agendar };
  };
  const A = await novaClinica('a');
  const B = await novaClinica('b');
  type C = typeof A;

  const env = (c: C, settings = {}) => ({ tenantId: c.id, userId: c.dono.id, settings: { ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false, ...settings }, today: HOJE as never });
  const settleEnv = (c: C) => ({ tenantId: c.id, userId: c.dono.id, access: { role: 'OWNER' as const }, settings: { ...DEFAULT_FINANCE_SETTINGS, requireOpenCashForCash: false }, today: HOJE as never });
  const situacao = async (c: C, id: string) => (await c.db.appointment.findFirst({ where: { id }, select: { billingStatus: true } }))?.billingStatus;
  const faturar = (c: C, input: Parameters<typeof appt.billAppointmentTx>[2], e = env(c)) => c.db.$transaction((tx) => appt.billAppointmentTx(tx, e, input));
  const receber = (c: C, titleId: string, amountCents: number) => c.db.$transaction((tx) => settleTitleTx(tx, settleEnv(c), { titleId, lines: [{ methodId: methodId(c.id, 'PIX'), amountCents, paidOn: HOJE as never }] }));
  const itens = (c: C, id: string, lista: Parameters<typeof appt.saveItemsTx>[3], e = env(c)) => c.db.$transaction((tx) => appt.saveItemsTx(tx, e, id, lista));
  const item = (p: { id: string; name: string }, unitPriceCents: number, extra: object = {}) => ({ procedureId: p.id, name: p.name, quantity: 1, unitPriceCents, discountCents: 0, ...extra });

  afterAll(async () => {
    for (const id of [A.id, B.id]) {
      const t = { tenantId: id };
      await prisma.financialRelease.deleteMany({ where: t });
      await prisma.walletEntry.deleteMany({ where: t });
      await prisma.cardReceivable.deleteMany({ where: t });
      await prisma.financialTransaction.deleteMany({ where: { ...t, reversalOfId: { not: null } } });
      await prisma.financialTransaction.deleteMany({ where: t });
      await prisma.financialTitleAllocation.deleteMany({ where: t });
      await prisma.financialTitle.deleteMany({ where: t });
      await prisma.payment.deleteMany({ where: t });
      await prisma.appointmentItem.deleteMany({ where: t });
      await prisma.appointment.deleteMany({ where: t });
      await prisma.quoteItem.deleteMany({ where: { quote: t } });
      await prisma.quote.deleteMany({ where: t });
      await prisma.finContact.deleteMany({ where: t });
      await prisma.finPaymentMethodFee.deleteMany({ where: t });
      await prisma.finPaymentMethod.deleteMany({ where: t });
      await prisma.financialCategory.deleteMany({ where: { ...t, parentId: { not: null } } });
      await prisma.financialCategory.deleteMany({ where: t });
      await prisma.financialAccount.deleteMany({ where: t });
      await prisma.auditLog.deleteMany({ where: t });
      await prisma.procedure.deleteMany({ where: t });
      await prisma.professional.deleteMany({ where: t });
      await prisma.patient.deleteMany({ where: t });
      await prisma.user.deleteMany({ where: t });
      await prisma.tenant.deleteMany({ where: { id } });
    }
  });

  it('agendamento antigo ganha o item do procedimento; cortesia e valor zero ficam sem valor', async () => {
    const p = await A.paciente('Itens');
    const a1 = await A.agendar(p.id, A.limpeza.id);
    const b1 = await refreshBillingTx(A.db, A.id, a1.id);
    expect(b1).toMatchObject({ status: 'TO_RECEIVE', chargeable: 20000, unbilled: 20000 });
    expect(await A.db.appointmentItem.count({ where: { appointmentId: a1.id } })).toBe(1);
    // Rodar de novo não repete o item.
    await refreshBillingTx(A.db, A.id, a1.id);
    expect(await A.db.appointmentItem.count({ where: { appointmentId: a1.id } })).toBe(1);

    const cortesia = await A.agendar(p.id, A.limpeza.id, { type: 'CORTESIA' });
    expect((await refreshBillingTx(A.db, A.id, cortesia.id))?.status).toBe('NONE');
    const zero = await A.agendar(p.id, A.gratis.id);
    expect((await refreshBillingTx(A.db, A.id, zero.id))?.status).toBe('NONE');
    const semProcedimento = await A.agendar(p.id, null);
    expect((await refreshBillingTx(A.db, A.id, semProcedimento.id))?.status).toBe('NONE');
    // Cortesia não se fatura.
    expect((await faturar(A, { appointmentId: cortesia.id, dueDate: HOJE as never })).ok).toBe(false);
  });

  it('itens: vários procedimentos, desconto, e o primeiro continua sendo o procedimento do agendamento', async () => {
    const p = await A.paciente('Vários');
    const a = await A.agendar(p.id, A.limpeza.id);
    const r = await itens(A, a.id, [item(A.consulta, 15000), item(A.limpeza, 20000, { quantity: 2, discountCents: 5000 })]);
    expect(r).toMatchObject({ ok: true, billing: { status: 'TO_RECEIVE', total: 50000, chargeable: 50000 } });
    expect((await A.db.appointment.findFirst({ where: { id: a.id } }))?.procedureId).toBe(A.consulta.id);
    // Desconto maior que o item, quantidade zero e procedimento de outra clínica são recusados.
    expect((await itens(A, a.id, [item(A.consulta, 15000, { discountCents: 15001 })])).ok).toBe(false);
    expect((await itens(A, a.id, [item(A.consulta, 15000, { quantity: 0 })])).ok).toBe(false);
    expect((await itens(A, a.id, [item(B.consulta, 15000)])).ok).toBe(false);
    expect(await A.db.appointmentItem.count({ where: { appointmentId: a.id } })).toBe(2);
  });

  it('item coberto por orçamento aprovado não gera cobrança e respeita o que falta executar', async () => {
    const p = await A.paciente('Orçamento');
    const q = await prisma.quote.create({
      data: { tenantId: A.id, patientId: p.id, number: 1, publicToken: `tok_ag_${suffix}`, status: 'ACCEPTED', subtotal: 900, total: 900, validUntil: new Date('2026-12-31T00:00:00.000Z'), acceptedAt: new Date(), items: { create: [{ procedureId: A.limpeza.id, name: 'Limpeza', unitPrice: 300, quantity: 3, total: 900 }] } },
      include: { items: true },
    });
    const qi = q.items[0];
    const a1 = await A.agendar(p.id, A.limpeza.id);
    const r1 = await itens(A, a1.id, [item(A.limpeza, 30000, { quantity: 2, quoteItemId: qi.id }), item(A.consulta, 15000)]);
    // Só a consulta cobra: a limpeza já está cobrada no orçamento.
    expect(r1).toMatchObject({ ok: true, billing: { status: 'TO_RECEIVE', total: 75000, chargeable: 15000 } });
    const f = await faturar(A, { appointmentId: a1.id, dueDate: HOJE as never });
    expect(f).toMatchObject({ ok: true, amountCents: 15000 });

    // Sobrou 1 para executar: pedir 2 em outro agendamento é recusado; 1 passa e fica "sem valor".
    const a2 = await A.agendar(p.id, A.limpeza.id);
    expect((await appt.quoteItemsFor(A.db, A.id, p.id, a2.id))[0]).toMatchObject({ quantity: 3, remaining: 1 });
    expect((await itens(A, a2.id, [item(A.limpeza, 30000, { quantity: 2, quoteItemId: qi.id })])).ok).toBe(false);
    const r2 = await itens(A, a2.id, [item(A.limpeza, 30000, { quoteItemId: qi.id })]);
    expect(r2).toMatchObject({ ok: true, billing: { status: 'NONE', chargeable: 0 } });
    expect((await faturar(A, { appointmentId: a2.id, dueDate: HOJE as never })).ok).toBe(false);
    // Item de orçamento de outro paciente não entra.
    const outro = await A.paciente('Outro');
    const a3 = await A.agendar(outro.id, A.limpeza.id);
    expect((await itens(A, a3.id, [item(A.limpeza, 30000, { quoteItemId: qi.id })])).ok).toBe(false);
  });

  it('faturar, receber em parte, quitar e estornar: a situação da agenda acompanha', async () => {
    const p = await A.paciente('Fluxo');
    const a = await A.agendar(p.id, A.limpeza.id);
    const f = await faturar(A, { appointmentId: a.id, dueDate: HOJE as never });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(await situacao(A, a.id)).toBe('BILLED');
    const t = await A.db.financialTitle.findFirst({ where: { id: f.titleIds[0] } });
    expect(t).toMatchObject({ origin: 'APPOINTMENT', appointmentId: a.id, patientId: p.id, professionalId: A.prof.id, competence: '2026-11', description: 'Limpeza' });
    // Faturar de novo não duplica.
    expect((await faturar(A, { appointmentId: a.id, dueDate: HOJE as never })).ok).toBe(false);
    expect(await appt.openTitleOf(A.db, A.id, a.id)).toBe(f.titleIds[0]);

    const parte = await receber(A, f.titleIds[0], 5000);
    expect(parte.ok).toBe(true);
    expect(await situacao(A, a.id)).toBe('PARTIAL');
    const resto = await receber(A, f.titleIds[0], 15000);
    expect(resto.ok).toBe(true);
    expect(await situacao(A, a.id)).toBe('PAID');
    expect(await appt.openTitleOf(A.db, A.id, a.id)).toBeNull();

    if (resto.ok) {
      const e = await A.db.$transaction((tx) => reverseTransactionTx(tx, { tenantId: A.id, userId: A.dono.id, today: HOJE as never }, { transactionId: resto.transactionIds[0], reason: 'Estorno do teste' }));
      expect(e.ok).toBe(true);
    }
    expect(await situacao(A, a.id)).toBe('PARTIAL');
    // Com pagamento, o agendamento não pode ser excluído.
    expect(await A.db.$transaction((tx) => appt.onDeletingTx(tx, env(A), a.id))).toBeTruthy();
  });

  it('faturar parcelado, cancelar a conta e a janela de receber fechada sem pagar', async () => {
    const p = await A.paciente('Parcelas');
    const a = await A.agendar(p.id, A.limpeza.id);
    const f = await faturar(A, { appointmentId: a.id, dueDate: HOJE as never, installments: 2 });
    expect(f.ok && f.titleIds.length).toBe(2);
    if (!f.ok) return;
    const ts = await A.db.financialTitle.findMany({ where: { id: { in: f.titleIds } }, orderBy: { installmentNumber: 'asc' } });
    expect(ts.map((t) => toCents(t.amount))).toEqual([10000, 10000]);
    expect(ts.map((t) => t.competence)).toEqual(['2026-11', '2026-11']);
    // Cancelar as duas parcelas devolve o agendamento para "a receber".
    for (const id of f.titleIds) expect((await cancelTitle({ tenantId: A.id, userId: A.dono.id, db: A.db }, id, 'Lançado errado')).ok).toBe(true);
    expect(await situacao(A, a.id)).toBe('TO_RECEIVE');

    // "Receber" cria o título; fechar a janela sem pagar some com ele.
    const f2 = await faturar(A, { appointmentId: a.id, dueDate: HOJE as never });
    expect(f2.ok).toBe(true);
    if (!f2.ok) return;
    expect(await A.db.$transaction((tx) => appt.discardUnpaidTitleTx(tx, A.id, f2.titleIds[0]))).toBe(true);
    expect(await A.db.financialTitle.findFirst({ where: { id: f2.titleIds[0] } })).toBeNull();
    expect(await situacao(A, a.id)).toBe('TO_RECEIVE');
    // Com pagamento, não some.
    const f3 = await faturar(A, { appointmentId: a.id, dueDate: HOJE as never });
    if (!f3.ok) return;
    await receber(A, f3.titleIds[0], 1000);
    expect(await A.db.$transaction((tx) => appt.discardUnpaidTitleTx(tx, A.id, f3.titleIds[0]))).toBe(false);
  });

  it('convênio: o título é do convênio, não do paciente, e pede o convênio', async () => {
    const p = await A.paciente('Conveniado');
    const a = await A.agendar(p.id, A.consulta.id, { type: 'CONVENIO' });
    expect((await faturar(A, { appointmentId: a.id, dueDate: HOJE as never })).ok).toBe(false);
    // Convênio de outra clínica não serve.
    expect((await faturar(A, { appointmentId: a.id, dueDate: HOJE as never, contactId: B.convenio.id })).ok).toBe(false);
    const f = await faturar(A, { appointmentId: a.id, dueDate: '2026-12-10' as never, contactId: A.convenio.id });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const t = await A.db.financialTitle.findFirst({ where: { id: f.titleIds[0] } });
    expect(t).toMatchObject({ patientId: null, contactId: A.convenio.id, appointmentId: a.id, description: 'Conveniado · Consulta' });
    expect((await A.db.appointment.findFirst({ where: { id: a.id } }))?.insuranceContactId).toBe(A.convenio.id);
    // O pagamento do convênio não vira pagamento do paciente nas telas antigas.
    expect((await receber(A, f.titleIds[0], 15000)).ok).toBe(true);
    expect(await A.db.payment.count({ where: { patientId: p.id } })).toBe(0);
    expect(await situacao(A, a.id)).toBe('PAID');
  });

  it('não cobrar: pede motivo, tira da cobrança, pode desfazer, e não vale com conta lançada', async () => {
    const p = await A.paciente('Não cobrar');
    const a = await A.agendar(p.id, A.limpeza.id);
    expect((await A.db.$transaction((tx) => appt.noChargeTx(tx, env(A), a.id, ' '))).ok).toBe(false);
    expect((await A.db.$transaction((tx) => appt.noChargeTx(tx, env(A), a.id, 'Retorno de garantia'))).ok).toBe(true);
    expect(await situacao(A, a.id)).toBe('NO_CHARGE');
    expect((await faturar(A, { appointmentId: a.id, dueDate: HOJE as never })).ok).toBe(false);
    expect((await A.db.$transaction((tx) => appt.undoNoChargeTx(tx, env(A), a.id))).ok).toBe(true);
    expect(await situacao(A, a.id)).toBe('TO_RECEIVE');
    await faturar(A, { appointmentId: a.id, dueDate: HOJE as never });
    expect((await A.db.$transaction((tx) => appt.noChargeTx(tx, env(A), a.id, 'Agora não dá'))).ok).toBe(false);
  });

  it('atendido: fatura sozinho quando a clínica liga, e o bloqueio do início respeita a regra', async () => {
    const p = await A.paciente('Atendido');
    const a = await A.agendar(p.id, A.limpeza.id, { status: 'ATTENDED' });
    // Regra desligada: nada é criado, e a tela recebe o que está em aberto para sugerir "Receber agora".
    expect(await A.db.$transaction((tx) => appt.onAttendedTx(tx, env(A), a.id))).toEqual({ openCents: 20000 });
    expect(await A.db.financialTitle.count({ where: { appointmentId: a.id } })).toBe(0);
    // Aparece no aviso do fechamento do caixa (atendido sem faturar).
    expect((await appt.unbilledAttended(A.db, A.id, HOJE as never, null, null)).map((x) => x.id)).toContain(a.id);
    expect(await appt.unbilledAttended(B.db, B.id, HOJE as never, null, null)).toHaveLength(0);

    expect(await A.db.$transaction((tx) => appt.onAttendedTx(tx, env(A, { autoBillOnFinish: true }), a.id))).toEqual({ openCents: 20000 });
    expect(await situacao(A, a.id)).toBe('BILLED');
    expect((await appt.unbilledAttended(A.db, A.id, HOJE as never, null, null)).map((x) => x.id)).not.toContain(a.id);

    const b = await A.agendar(p.id, A.limpeza.id);
    expect(await appt.startBlockReason(A.db, env(A), b.id)).toBeNull();
    expect(await appt.startBlockReason(A.db, env(A, { blockStartWithoutPayment: 'BILLED' }), b.id)).toBeTruthy();
    const f = await faturar(A, { appointmentId: b.id, dueDate: HOJE as never });
    expect(await appt.startBlockReason(A.db, env(A, { blockStartWithoutPayment: 'BILLED' }), b.id)).toBeNull();
    expect(await appt.startBlockReason(A.db, env(A, { blockStartWithoutPayment: 'PAID' }), b.id)).toBeTruthy();
    if (f.ok) await receber(A, f.titleIds[0], 20000);
    expect(await appt.startBlockReason(A.db, env(A, { blockStartWithoutPayment: 'PAID' }), b.id)).toBeNull();
  });

  it('depois de atendido, mudar itens depende da regra da clínica e fica na auditoria', async () => {
    const p = await A.paciente('Depois');
    const a = await A.agendar(p.id, A.limpeza.id, { status: 'ATTENDED' });
    expect((await itens(A, a.id, [item(A.consulta, 15000)], env(A, { editItemsAfterAttended: false }))).ok).toBe(false);
    expect((await itens(A, a.id, [item(A.consulta, 15000)])).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A.id, entity: 'Appointment', entityId: a.id, action: 'ITEMS_CHANGED' } })).toBe(1);
  });

  it('excluir agendamento sem pagamento cancela as contas em aberto; nada de uma clínica alcança a outra', async () => {
    const p = await A.paciente('Excluir');
    const a = await A.agendar(p.id, A.limpeza.id);
    const f = await faturar(A, { appointmentId: a.id, dueDate: HOJE as never });
    expect(await A.db.$transaction((tx) => appt.onDeletingTx(tx, env(A), a.id))).toBeNull();
    if (f.ok) expect(await A.db.financialTitle.findFirst({ where: { id: f.titleIds[0] } })).toMatchObject({ status: 'CANCELLED', appointmentId: null });

    // A clínica B não fatura, não muda itens nem marca "não cobrar" em agendamento da A.
    const b = await A.agendar(p.id, A.limpeza.id);
    expect((await faturar(B, { appointmentId: b.id, dueDate: HOJE as never })).ok).toBe(false);
    expect((await itens(B, b.id, [item(B.consulta, 100)])).ok).toBe(false);
    expect((await B.db.$transaction((tx) => appt.noChargeTx(tx, env(B), b.id, 'Tentativa de fora'))).ok).toBe(false);
    expect(await refreshBillingTx(B.db, B.id, b.id)).toBeNull();
  });
});
