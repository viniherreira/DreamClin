-- Financeiro completo, fase 6 (comissões e repasses): banco de produção (Supabase).
-- Só acrescenta: três tabelas vazias (exceções de comissão, tipos de repasse e
-- linhas de comissão) e a coluna vazia de custo de material nos procedimentos.
-- Nenhum dado existente muda.
BEGIN;

-- AlterTable
ALTER TABLE "procedures" ADD COLUMN     "costPrice" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "commission_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "procedureId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'FIXED',
    "value" DECIMAL(12,2) NOT NULL,
    "contactId" TEXT,
    "procedureIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMISSION',
    "professionalId" TEXT,
    "contactId" TEXT,
    "transferTypeId" TEXT,
    "appointmentId" TEXT,
    "appointmentItemId" TEXT,
    "procedureId" TEXT,
    "trigger" TEXT NOT NULL,
    "triggerTransactionId" TEXT,
    "description" TEXT NOT NULL,
    "base" DECIMAL(12,2) NOT NULL,
    "ruleLabel" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "adjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "occurredOn" DATE NOT NULL,
    "competence" TEXT NOT NULL,
    "payableTitleId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_exceptions_tenantId_professionalId_idx" ON "commission_exceptions"("tenantId", "professionalId");

-- CreateIndex
CREATE INDEX "transfer_types_tenantId_active_idx" ON "transfer_types"("tenantId", "active");

-- CreateIndex
CREATE INDEX "commission_entries_tenantId_professionalId_occurredOn_idx" ON "commission_entries"("tenantId", "professionalId", "occurredOn");

-- CreateIndex
CREATE INDEX "commission_entries_tenantId_appointmentId_idx" ON "commission_entries"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "commission_entries_tenantId_triggerTransactionId_idx" ON "commission_entries"("tenantId", "triggerTransactionId");

-- CreateIndex
CREATE INDEX "commission_entries_tenantId_payableTitleId_idx" ON "commission_entries"("tenantId", "payableTitleId");

-- AddForeignKey
ALTER TABLE "commission_exceptions" ADD CONSTRAINT "commission_exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_types" ADD CONSTRAINT "transfer_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_entries" ENABLE ROW LEVEL SECURITY;

COMMIT;
