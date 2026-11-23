'use client';

import { usePathname } from 'next/navigation';
import { useLiveUnread } from './crm-chat/unread';
import {
  LayoutDashboard, CalendarDays, Users, Stethoscope, FileText, Wallet,
  MessageCircle, Megaphone, Settings, PhoneCall, KanbanSquare, List, ListChecks, Smartphone, BarChart3, Zap, TrendingUp, Receipt, Banknote, ClipboardList, Percent, Cake, CalendarCheck, Hourglass, Sun,
} from 'lucide-react';
import { CrmRail } from './crm-rail';
import { ClinicSidebar } from './clinic-sidebar';
import { clinicHomeFor, type Space } from './module-switcher';
import { can, type Capability } from '@/lib/permissions';

/**
 * O menu, com a permissão que cada módulo exige.
 *
 * Quase tudo é do dia a dia da clínica e aparece para quem tem login. Some só
 * o que é de administração — hoje, Plano e cobrança.
 *
 * Isto é arrumação, não segurança. Quem digitar o endereço direto continua
 * sendo barrado no servidor, por `requireCapability`.
 */
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
  capability?: Capability;
  /** O nome que cabe no menu estreito do CRM. */
  short?: string;
  /** Grupo no menu da clínica (`CLINIC_GROUPS`); sem grupo, fica solto no topo. */
  group?: string;
};

export const CLINIC_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays, capability: 'agenda', group: 'Atendimento' },
  { href: '/pacientes', label: 'Pacientes', icon: Users, capability: 'pacientes', group: 'Atendimento' },
  { href: '/retorno', label: 'Retorno', icon: PhoneCall, capability: 'pacientes', group: 'Atendimento' },
  { href: '/orcamentos', label: 'Orçamentos', icon: FileText, capability: 'financeiro', group: 'Financeiro' },
  // Financeiro e relatórios são uma tela só: resumo em cima, detalhamento embaixo.
  { href: '/financeiro', label: 'Financeiro', icon: Wallet, capability: 'financeiro', group: 'Financeiro' },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, capability: 'configuracoes', group: 'Relacionamento' },
  { href: '/campanhas', label: 'Campanhas', icon: Megaphone, capability: 'campanhas', group: 'Relacionamento' },
  { href: '/procedimentos', label: 'Procedimentos', icon: Stethoscope, capability: 'configuracoes', group: 'Configurações' },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, capability: 'configuracoes', group: 'Configurações' },
];

/**
 * Os itens do financeiro completo: entram no grupo Financeiro só na clínica com
 * a bandeira ligada (`fin/flag.ts`). As outras telas do financeiro ficam nas
 * abas do topo de cada uma (`components/fin/fin-nav.tsx`).
 */
export const FINANCE_NAV: NavItem[] = [
  { href: '/financeiro/caixa', label: 'Caixa', icon: Banknote, capability: 'fin_caixa', group: 'Financeiro' },
  { href: '/financeiro/a-faturar', label: 'A faturar', icon: ClipboardList, capability: 'fin_ver', group: 'Financeiro' },
  { href: '/financeiro/contas', label: 'Contas', icon: Receipt, capability: 'fin_ver', group: 'Financeiro' },
  { href: '/financeiro/comissoes', label: 'Comissões', icon: Percent, capability: 'fin_comissoes', group: 'Financeiro' },
];

/**
 * Telas do paciente e da agenda novos (spec 2026-11-18), só com a bandeira
 * `pacienteAgendaEnabled`. Cada item entra logo depois do endereço da chave.
 */
export const PATIENT_AGENDA_NAV: Record<string, NavItem[]> = {
  '/agenda': [
    { href: '/agenda/confirmacoes', label: 'Confirmações', icon: CalendarCheck, capability: 'agenda', group: 'Atendimento' },
    { href: '/agenda/lista-de-espera', label: 'Lista de espera', icon: Hourglass, capability: 'agenda', group: 'Atendimento' },
    { href: '/agenda/meu-dia', label: 'Meu dia', icon: Sun, capability: 'agenda', group: 'Atendimento' },
  ],
  '/pacientes': [{ href: '/pacientes/aniversariantes', label: 'Aniversariantes', icon: Cake, capability: 'pacientes', group: 'Atendimento' }],
};

/**
 * O menu do espaço CRM. Transmissões e Chatbot entram nas próximas etapas. O
 * próprio espaço só abre para quem tem `crm` (ver `crm/guard.ts`).
 */
export const CRM_NAV: NavItem[] = [
  { href: '/crm/painel', label: 'Painel', icon: BarChart3, capability: 'crm' },
  { href: '/crm', label: 'Funil', icon: KanbanSquare, capability: 'crm' },
  { href: '/crm/conversas', label: 'Conversas', icon: MessageCircle, capability: 'crm' },
  { href: '/crm/leads', label: 'Leads', icon: List, capability: 'crm' },
  { href: '/crm/tarefas', label: 'Tarefas', icon: ListChecks, capability: 'crm' },
  { href: '/crm/automacoes', label: 'Automações', icon: Zap, capability: 'crm' },
  { href: '/crm/anuncios', label: 'Anúncios', icon: TrendingUp, capability: 'crm' },
  { href: '/crm/whatsapp', label: 'Canais', icon: Smartphone, capability: 'crm_config' },
  // Todo mundo entra (o próprio perfil); a equipe, os funis e o resto são do gestor.
  { href: '/crm/configuracoes', label: 'Configurações do CRM', short: 'Configurações', icon: Settings, capability: 'crm' },
];

/**
 * O menu de quem está logado. No CRM, o que é de configurar (`crm_config`) sai
 * do cargo no CRM (`crmManager`), não do perfil da clínica; sem ele informado,
 * vale o padrão do perfil.
 */
export function navFor(role: string | null | undefined, space: Space = 'clinic', crmOnly = false, crmManager?: boolean, finance = false, patientAgenda = false) {
  // Os itens do financeiro novo entram logo depois de "Financeiro"; os do paciente e da agenda, depois da tela deles.
  const clinica = CLINIC_NAV.flatMap((item) => [
    item,
    ...(finance && item.href === '/financeiro' ? FINANCE_NAV : []),
    ...(patientAgenda ? (PATIENT_AGENDA_NAV[item.href] ?? []) : []),
  ]);
  const nav = space === 'crm' ? CRM_NAV : clinica.filter((item) => !crmOnly || item.href === '/configuracoes');
  return nav.filter((item) => {
    if (!item.capability) return true;
    if (item.capability === 'crm_config' && crmManager !== undefined) return can(role, 'crm') && crmManager;
    return can(role, item.capability);
  });
}

/**
 * Item ativo: o de endereço mais longo que casa com a página. Sem isso, em
 * /crm/leads o "Funil" (/crm) também acenderia, porque /crm/leads começa com /crm.
 */
export function activeHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function AppSidebar({
  clinicName,
  role,
  space = 'clinic',
  showSwitcher = false,
  counts = {},
  crmOnly = false,
  crmManager,
  finance = false,
  patientAgenda = false,
}: {
  clinicName: string;
  /** Financeiro completo ligado nesta clínica. */
  finance?: boolean;
  /** Paciente e agenda novos ligados nesta clínica. */
  patientAgenda?: boolean;
  /** É Gestor no CRM (mostra Equipe, WhatsApp e Configurações do CRM). */
  crmManager?: boolean;
  role: string;
  space?: Space;
  /** A clínica tem os dois módulos e a pessoa alcança o CRM. */
  showSwitcher?: boolean;
  /** A clínica contratou só o CRM: do lado da clínica, só Configurações. */
  crmOnly?: boolean;
  /** Números ao lado de um item (conversas não lidas), por endereço. */
  counts?: Record<string, number>;
}) {
  const pathname = usePathname();
  const itens = navFor(role, space, crmOnly, crmManager, finance, patientAgenda);
  const unread = useLiveUnread(counts['/crm/conversas'] ?? 0);
  const contagem: Record<string, number> = { ...counts, '/crm/conversas': unread };
  const ativo = activeHref(itens, pathname);

  if (space === 'crm') {
    return (
      <CrmRail items={itens} active={ativo} counts={contagem} clinicName={clinicName} showSwitcher={showSwitcher} clinicHome={clinicHomeFor(crmOnly)} crmOnly={crmOnly} />
    );
  }
  return <ClinicSidebar items={itens} active={ativo} clinicName={clinicName} showSwitcher={showSwitcher} clinicHome={clinicHomeFor(crmOnly)} />;
}
