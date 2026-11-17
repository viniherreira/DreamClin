-- Financeiro completo, fase 4 (agenda): banco de produção (Supabase).
-- Só acrescenta uma coluna vazia nos agendamentos: o convênio que paga o
-- atendimento (quando o tipo é convênio). Nenhum agendamento existente muda.
BEGIN;

ALTER TABLE "appointments" ADD COLUMN "insuranceContactId" TEXT;

COMMIT;
