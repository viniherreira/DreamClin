import 'server-only';

import { decrypt, getTenantClient, prisma } from '@clinicaiq/db';
import { countBy, daysBetween, daysDiff, pct, workMinutes, type Cell, type ReportKey, type ReportTable } from './agenda-reports';
import { buildWorkingHoursMap } from './working-hours';
import { holidaysBetween } from './holidays';
import { displayName } from './patient-name';
import { attendanceOf } from './attendance';
import { confirmedByPatient } from './appointment-status';
import { PERIODS, WAITLIST_STATUS } from './waitlist';
import { readCustomAnswers } from './patient-fields';
import { clinicToday, wallClockTime, wallDateBR } from './tz';

/**
 * Busca as linhas de cada relatório (spec 2026-11-18, F8). Só leitura, sempre
 * pelo `getTenantClient`. Quem chama confere a permissão antes.
 */

export interface ReportFilters {
  from: string;
  to: string;
  professionalId?: string;
  /** Relatório "dimensao": tipo, sala, procedimento, convenio ou pagamento. */
  dim?: string;
  /** Relatório "sem-agendar": dias desde o último atendimento. */
  days?: number;
}

export const DIMENSIONS = [
  { value: 'tipo', label: 'Tipo de atendimento' },
  { value: 'sala', label: 'Sala ou equipamento' },
  { value: 'procedimento', label: 'Procedimento' },
  { value: 'convenio', label: 'Convênio' },
  { value: 'pagamento', label: 'Particular, convênio ou cortesia' },
] as const;

const ini = (d: string) => new Date(`${d}T00:00:00.000Z`);
const fim = (d: string) => new Date(`${d}T23:59:59.999Z`);
const dataBR = (d: Date | null | undefined) => (d ? wallDateBR(d) : '');
const dataHora = (d: Date) => `${wallDateBR(d)} ${wallClockTime(d)}`;
const SOURCE: Record<string, string> = { WHATSAPP: 'WhatsApp (paciente)', LINK: 'Link (paciente)', PHONE: 'Telefone', RECEPTION: 'Recepção' };
const ORIGEM_REMARCACAO: Record<string, string> = { AGENDA: 'Janela do agendamento', DRAG: 'Arrastou na agenda', BULK: 'Alteração em massa' };
const PAGAMENTO: Record<string, string> = { PARTICULAR: 'Particular', CONVENIO: 'Convênio', CORTESIA: 'Cortesia' };

function abrir(cifra: string | null | undefined, tenantId: string): string {
  if (!cifra) return '';
  try {
    return decrypt(cifra, process.env.ENCRYPTION_MASTER_KEY ?? '', tenantId);
  } catch {
    return '';
  }
}

async function nomesDeUsuarios(tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const us = await prisma.user.findMany({ where: { tenantId, id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}

export async function runReport(tenantId: string, key: ReportKey, f: ReportFilters): Promise<ReportTable> {
  const db = getTenantClient(tenantId);
  const doProf = f.professionalId ? { professionalId: f.professionalId } : {};
  const noPeriodo = { startTime: { gte: ini(f.from), lte: fim(f.to) } };

  switch (key) {
    case 'situacao': {
      const [ags, profs] = await Promise.all([
        db.appointment.findMany({ where: { ...noPeriodo, ...doProf }, select: { professionalId: true, status: true, cancelledBy: true, confirmationSource: true } }),
        db.professional.findMany({ select: { id: true, name: true } }),
      ]);
      const linha = (nome: string, lista: typeof ags): Cell[] => {
        const at = attendanceOf(lista);
        const conf = lista.filter((a) => a.status === 'CONFIRMED');
        const pacConf = conf.filter((a) => confirmedByPatient(a.confirmationSource)).length;
        return [
          nome,
          lista.filter((a) => a.status === 'SCHEDULED' || a.status === 'RESCHEDULED').length,
          conf.length - pacConf,
          pacConf,
          at.attended,
          at.missed,
          at.cancelledByPatient,
          at.cancelledByClinic + at.cancelledUnknown,
          lista.length,
          at.missRate === null ? 0 : Math.round(at.missRate * 1000) / 10,
        ];
      };
      const porProf = new Map<string, typeof ags>();
      for (const a of ags) porProf.set(a.professionalId, [...(porProf.get(a.professionalId) ?? []), a]);
      return {
        columns: ['Profissional', 'A confirmar', 'Confirmado pela clínica', 'Confirmado pelo paciente', 'Atendido', 'Faltou', 'Cancelado pelo paciente', 'Cancelado pela clínica', 'Total', 'Taxa de falta'],
        rows: [...porProf.entries()].map(([id, l]) => linha(profs.find((p) => p.id === id)?.name ?? '—', l)).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR')),
        total: ags.length ? linha('Total', ags) : undefined,
        percentColumns: [9],
        note: 'Taxa de falta = faltas ÷ (atendidos + faltas). Cancelamento com antecedência não conta como falta.',
      };
    }

    case 'confirmacao': {
      const ags = await db.appointment.findMany({ where: { ...noPeriodo, ...doProf, status: { in: ['CONFIRMED', 'ATTENDED'] } }, select: { confirmationSource: true } });
      const c = countBy(ags, (a) => (a.confirmationSource ? SOURCE[a.confirmationSource] ?? a.confirmationSource : null), 'Sem registro (antes de 11/2026 ou direto como atendido)');
      return { columns: ['Por onde confirmou', 'Agendamentos', '% do total'], rows: c.map((x) => [x.label, x.total, pct(x.total, ags.length)]), total: ['Total', ags.length, ags.length ? 100 : 0], percentColumns: [2] };
    }

    case 'criacao': {
      const ags = await db.appointment.findMany({ where: { createdAt: { gte: ini(f.from), lte: fim(f.to) }, ...doProf }, select: { createdById: true, status: true } });
      const nomes = await nomesDeUsuarios(tenantId, ags.map((a) => a.createdById));
      const grupos = new Map<string, typeof ags>();
      for (const a of ags) {
        const k = a.createdById ? nomes.get(a.createdById) ?? 'Usuário removido' : 'Sem registro (online, WhatsApp ou antigo)';
        grupos.set(k, [...(grupos.get(k) ?? []), a]);
      }
      const rows = [...grupos.entries()]
        .map(([k, l]) => [k, l.length, l.filter((a) => a.status === 'ATTENDED').length, l.filter((a) => a.status === 'CANCELLED').length] as Cell[])
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      return { columns: ['Quem marcou', 'Agendamentos criados', 'Já atendidos', 'Cancelados'], rows, total: ['Total', ags.length, ags.filter((a) => a.status === 'ATTENDED').length, ags.filter((a) => a.status === 'CANCELLED').length], note: 'Conta pela data em que o agendamento foi criado, não pela data da consulta.' };
    }

    case 'dimensao': {
      const dim = DIMENSIONS.some((d) => d.value === f.dim) ? f.dim! : 'tipo';
      const ags = await db.appointment.findMany({
        where: { ...noPeriodo, ...doProf },
        select: { status: true, type: true, careTypeId: true, agendaId: true, insuranceContactId: true, procedure: { select: { name: true } }, items: { select: { procedure: { select: { name: true } } } } },
      });
      const [tipos, salas, convenios] = await Promise.all([
        dim === 'tipo' ? db.careType.findMany({ select: { id: true, name: true } }) : [],
        dim === 'sala' ? db.agendaResource.findMany({ select: { id: true, name: true } }) : [],
        dim === 'convenio' ? db.finContact.findMany({ where: { id: { in: [...new Set(ags.map((a) => a.insuranceContactId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }) : [],
      ]);
      const chaves = (a: (typeof ags)[number]): string[] => {
        if (dim === 'tipo') return [tipos.find((t) => t.id === a.careTypeId)?.name ?? 'Sem tipo'];
        if (dim === 'sala') return [salas.find((t) => t.id === a.agendaId)?.name ?? 'Sem sala'];
        if (dim === 'convenio') return [a.type === 'CONVENIO' ? convenios.find((t) => t.id === a.insuranceContactId)?.name ?? 'Convênio sem nome' : 'Não é convênio'];
        if (dim === 'pagamento') return [PAGAMENTO[a.type] ?? a.type];
        const nomes = [...new Set([a.procedure?.name, ...a.items.map((i) => i.procedure?.name)].filter((x): x is string => !!x))];
        return nomes.length ? nomes : ['Sem procedimento'];
      };
      const grupos = new Map<string, typeof ags>();
      for (const a of ags) for (const k of chaves(a)) grupos.set(k, [...(grupos.get(k) ?? []), a]);
      const rows = [...grupos.entries()]
        .map(([k, l]) => [k, l.length, l.filter((a) => a.status === 'ATTENDED').length, l.filter((a) => a.status === 'MISSED').length, l.filter((a) => a.status === 'CANCELLED').length] as Cell[])
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      return {
        columns: [DIMENSIONS.find((d) => d.value === dim)!.label, 'Agendamentos', 'Atendidos', 'Faltas', 'Cancelados'],
        rows,
        note: dim === 'procedimento' ? 'Um agendamento com dois procedimentos conta nos dois.' : undefined,
      };
    }

    case 'ocupacao': {
      const profs = await db.professional.findMany({ where: { active: true, ...(f.professionalId ? { id: f.professionalId } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
      const [semanas, custom, ags, bloqs] = await Promise.all([
        buildWorkingHoursMap(tenantId, profs.map((p) => p.id)),
        db.holiday.findMany({ select: { date: true, name: true } }),
        db.appointment.findMany({ where: { ...noPeriodo, professionalId: { in: profs.map((p) => p.id) }, status: { notIn: ['CANCELLED'] } }, select: { professionalId: true, startTime: true, endTime: true, status: true } }),
        db.blockedSlot.findMany({ where: { startTime: { lte: fim(f.to) }, endTime: { gte: ini(f.from) }, professionalId: { in: profs.map((p) => p.id) } }, select: { professionalId: true, startTime: true, endTime: true } }),
      ]);
      const feriados = new Set(holidaysBetween(f.from, f.to, custom.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name }))).map((h) => h.date));
      const dias = daysBetween(f.from, f.to).filter((d) => !feriados.has(d));
      const minutos = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60_000);
      const rows: Cell[][] = profs.map((p) => {
        const semana = semanas[p.id] ?? [];
        let disponivel = 0;
        for (const d of dias) disponivel += workMinutes(semana[new Date(`${d}T00:00:00Z`).getUTCDay()]);
        const bloqueado = bloqs
          .filter((b) => b.professionalId === p.id)
          .reduce((s, b) => s + minutos(b.startTime < ini(f.from) ? ini(f.from) : b.startTime, b.endTime > fim(f.to) ? fim(f.to) : b.endTime), 0);
        disponivel = Math.max(0, disponivel - bloqueado);
        const meus = ags.filter((a) => a.professionalId === p.id && !feriados.has(a.startTime.toISOString().slice(0, 10)));
        const ocupado = meus.reduce((s, a) => s + minutos(a.startTime, a.endTime), 0);
        return [p.name, Math.round((disponivel / 60) * 10) / 10, Math.round((ocupado / 60) * 10) / 10, pct(Math.min(ocupado, disponivel || ocupado), disponivel), meus.filter((a) => a.status === 'ATTENDED').length];
      });
      return {
        columns: ['Profissional', 'Horas disponíveis', 'Horas agendadas', 'Ocupação', 'Atendidos'],
        rows,
        percentColumns: [3],
        note: 'Horas disponíveis = horário de atendimento de cada dia, sem almoço, feriados e bloqueios. Cancelados não ocupam.',
      };
    }

    case 'remarcacoes': {
      const rs = await db.appointmentReschedule.findMany({
        where: { createdAt: { gte: ini(f.from), lte: fim(f.to) }, ...(f.professionalId ? { OR: [{ fromProfessionalId: f.professionalId }, { toProfessionalId: f.professionalId }] } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 3000,
      });
      const [pacs, profs, nomes] = await Promise.all([
        db.patient.findMany({ where: { id: { in: [...new Set(rs.map((r) => r.patientId))] } }, select: { id: true, name: true, socialName: true } }),
        db.professional.findMany({ select: { id: true, name: true } }),
        nomesDeUsuarios(tenantId, rs.map((r) => r.byUserId)),
      ]);
      const prof = (id: string | null) => (id ? profs.find((p) => p.id === id)?.name ?? '' : '');
      return {
        columns: ['Remarcado em', 'Paciente', 'Era', 'Ficou', 'Profissional antes', 'Profissional depois', 'Motivo', 'Paciente pediu', 'Por onde', 'Quem'],
        rows: rs.map((r) => {
          const p = pacs.find((x) => x.id === r.patientId);
          return [dataHora(r.createdAt), p ? displayName(p) : '—', dataHora(r.fromStart), dataHora(r.toStart), prof(r.fromProfessionalId), prof(r.toProfessionalId), r.reason ?? '', r.patientAsked ? 'Sim' : 'Não', ORIGEM_REMARCACAO[r.source] ?? r.source, r.byUserId ? nomes.get(r.byUserId) ?? '' : 'Paciente'];
        }),
        note: rs.length === 3000 ? 'Mostrando as 3.000 mais recentes.' : undefined,
      };
    }

    case 'lista-de-espera': {
      const es = await db.waitlistEntry.findMany({ where: { createdAt: { gte: ini(f.from), lte: fim(f.to) }, ...(f.professionalId ? { professionalId: f.professionalId } : {}) }, orderBy: { createdAt: 'asc' }, take: 3000 });
      const [pacs, profs] = await Promise.all([
        db.patient.findMany({ where: { id: { in: [...new Set(es.map((r) => r.patientId))] } }, select: { id: true, name: true, socialName: true, phoneEncrypted: true } }),
        db.professional.findMany({ select: { id: true, name: true } }),
      ]);
      const hoje = new Date(`${clinicToday()}T12:00:00Z`);
      return {
        columns: ['Entrou', 'Paciente', 'Telefone', 'Profissional', 'Período', 'Situação', 'Dias na lista', 'Motivo da saída'],
        rows: es.map((e) => {
          const p = pacs.find((x) => x.id === e.patientId);
          return [
            dataBR(e.createdAt),
            p ? displayName(p) : '—',
            abrir(p?.phoneEncrypted, tenantId),
            e.professionalId ? profs.find((x) => x.id === e.professionalId)?.name ?? '' : 'Qualquer',
            PERIODS.find((x) => x.value === e.period)?.label ?? e.period,
            WAITLIST_STATUS[e.status] ?? e.status,
            daysDiff(e.createdAt, e.status === 'WAITING' ? hoje : e.updatedAt),
            e.removedReason ?? '',
          ];
        }),
        note: `${es.filter((e) => e.status === 'WAITING').length} ainda esperando, ${es.filter((e) => e.status === 'SCHEDULED' || e.status === 'ATTENDED').length} conseguiram horário.`,
      };
    }

    case 'sem-agendar': {
      const dias = Math.max(1, Math.min(3650, f.days ?? 180));
      const corte = new Date(Date.now() - dias * 86_400_000);
      const [ultimos, futuros] = await Promise.all([
        db.appointment.groupBy({ by: ['patientId'], where: { status: 'ATTENDED', ...doProf }, _max: { startTime: true } }),
        db.appointment.findMany({ where: { startTime: { gte: ini(clinicToday()) }, status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] } }, select: { patientId: true }, distinct: ['patientId'] }),
      ]);
      const comFuturo = new Set(futuros.map((x) => x.patientId));
      const alvo = ultimos.filter((u) => u._max.startTime && u._max.startTime < corte && !comFuturo.has(u.patientId));
      const pacs = await db.patient.findMany({ where: { id: { in: alvo.map((a) => a.patientId) }, deletedAt: null, active: true }, select: { id: true, name: true, socialName: true, controlNumber: true, phoneEncrypted: true, whatsappOptOut: true } });
      const ultimo = new Map(alvo.map((a) => [a.patientId, a._max.startTime!]));
      const rows = pacs
        .map((p) => ({ p, d: ultimo.get(p.id)! }))
        .sort((a, b) => b.d.getTime() - a.d.getTime())
        .slice(0, 3000)
        .map(({ p, d }) => [displayName(p), p.controlNumber, abrir(p.phoneEncrypted, tenantId), dataBR(d), daysDiff(d, new Date()), p.whatsappOptOut ? 'Não' : 'Sim'] as Cell[]);
      return { columns: ['Paciente', 'Nº', 'Telefone', 'Último atendimento', 'Dias sem vir', 'Aceita WhatsApp'], rows, note: `Atendidos há mais de ${dias} dias e sem nada marcado para frente. Os de atendimento mais recente vêm primeiro.` };
    }

    case 'cadastro': {
      const ps = await db.patient.findMany({
        where: { createdAt: { gte: ini(f.from), lte: fim(f.to) }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 3000,
        select: { name: true, socialName: true, controlNumber: true, phoneEncrypted: true, createdAt: true, referredBy: true, city: true, origin: { select: { name: true } } },
      });
      const origens = countBy(ps, (p) => p.origin?.name, 'Sem origem');
      return {
        columns: ['Cadastro', 'Nº', 'Paciente', 'Telefone', 'Origem', 'Indicado por', 'Cidade'],
        rows: ps.map((p) => [dataBR(p.createdAt), p.controlNumber, displayName(p), abrir(p.phoneEncrypted, tenantId), p.origin?.name ?? '', p.referredBy ?? '', p.city ?? '']),
        note: ps.length ? `Por origem: ${origens.map((o) => `${o.label} ${o.total}`).join(', ')}.` : undefined,
      };
    }

    case 'cidade': {
      const ags = await db.appointment.findMany({ where: { ...noPeriodo, ...doProf, status: 'ATTENDED' }, select: { patientId: true }, distinct: ['patientId'] });
      const ps = await db.patient.findMany({ where: { id: { in: ags.map((a) => a.patientId) } }, select: { city: true, neighborhood: true, state: true } });
      const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
      const c = countBy(ps, (p) => `${norm(p.city) || 'Sem cidade'}${p.state ? ` (${p.state.toUpperCase()})` : ''}|${norm(p.neighborhood) || 'Sem bairro'}`);
      return {
        columns: ['Cidade', 'Bairro', 'Pacientes atendidos', '% do total'],
        rows: c.map((x) => {
          const [cidade, bairro] = x.label.split('|');
          return [cidade, bairro, x.total, pct(x.total, ps.length)];
        }),
        total: ['Total', '', ps.length, ps.length ? 100 : 0],
        percentColumns: [3],
        note: 'Cada paciente conta uma vez, mesmo com vários atendimentos no período.',
      };
    }

    case 'informacoes': {
      const [defs, ps] = await Promise.all([
        db.patientCustomField.findMany({ where: { active: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
        db.patient.findMany({ where: { deletedAt: null }, select: { customFields: true } }),
      ]);
      const respostas = ps.map((p) => readCustomAnswers(p.customFields));
      const rows: Cell[][] = [];
      for (const d of defs) {
        const vals = respostas.map((r) => r[d.id]?.v).filter((v): v is string | string[] => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
        if (d.type === 'SINGLE' || d.type === 'MULTI') {
          const c = countBy(vals.flatMap((v) => (Array.isArray(v) ? v : [v])), (x) => x);
          if (!c.length) rows.push([d.label, 'Ninguém respondeu', 0]);
          for (const x of c) rows.push([d.label, x.label, x.total]);
        } else {
          rows.push([d.label, 'Responderam', vals.length]);
        }
      }
      return { columns: ['Campo', 'Resposta', 'Pacientes'], rows, note: defs.length ? undefined : 'A clínica ainda não criou campos em Configurações, Cadastro do paciente.' };
    }
  }
}
