import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@clinicaiq/db';
import { currentAccess } from '@/lib/guard';
import { hasCapability } from '@/lib/access';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { reportDef, tableToRows } from '@/lib/agenda-reports';
import { runReport } from '@/lib/agenda-reports-server';
import { buildXlsx } from '@/lib/xlsx';
import { toCsv } from '@/lib/csv';
import { readReportFilters } from '../filters';

/**
 * Baixa o relatório da agenda em Excel ou CSV. Relatório com nome e telefone
 * de paciente só para quem tem `pacientes_exportar`. Cada exportação fica na
 * auditoria (qual relatório, período e quantas linhas).
 */
export async function GET(req: NextRequest) {
  const acesso = await currentAccess();
  if (!acesso) return new NextResponse('Entre de novo.', { status: 401 });
  const { tenantId, userId } = acesso;
  if (!(await pacienteAgendaEnabled(tenantId))) return new NextResponse('Não encontrado.', { status: 404 });
  if (!(await hasCapability(tenantId, 'agenda_config'))) return new NextResponse('Seu perfil não vê os relatórios da agenda.', { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const def = reportDef(sp.tipo);
  if (def.personal && !(await hasCapability(tenantId, 'pacientes_exportar'))) return new NextResponse('Seu perfil não exporta dados de pacientes.', { status: 403 });
  const filtros = readReportFilters(sp);
  const tabela = await runReport(tenantId, def.key, filtros);
  await prisma.auditLog.create({
    data: { tenantId, userId, action: 'AGENDA_REPORT_EXPORTED', entity: 'Report', entityId: def.key, metadata: { de: filtros.from, ate: filtros.to, linhas: tabela.rows.length, formato: sp.formato === 'csv' ? 'csv' : 'xlsx' } },
  });
  const nome = `relatorio-${def.key}-${filtros.from}-a-${filtros.to}`;
  const linhas = tableToRows(tabela);
  if (sp.formato === 'csv') {
    const [cab, ...resto] = linhas;
    return new NextResponse(`﻿${toCsv(cab.map(String), resto)}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"`, 'Cache-Control': 'no-store' },
    });
  }
  const arquivo = buildXlsx([{ name: def.title.slice(0, 31), rows: linhas }]);
  return new NextResponse(Buffer.from(arquivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nome}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
