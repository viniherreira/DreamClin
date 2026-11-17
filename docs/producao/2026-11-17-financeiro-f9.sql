-- Financeiro completo, fase 9 (régua de cobrança): banco de produção (Supabase).
-- Só acrescenta: uma tabela vazia com os avisos já mandados (para nunca repetir).
-- Nenhum dado existente muda.
BEGIN;

-- CreateTable
CREATE TABLE "collection_dispatches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_dispatches_tenantId_createdAt_idx" ON "collection_dispatches"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "collection_dispatches_tenantId_titleId_step_key" ON "collection_dispatches"("tenantId", "titleId", "step");

-- AddForeignKey
ALTER TABLE "collection_dispatches" ADD CONSTRAINT "collection_dispatches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "collection_dispatches" ENABLE ROW LEVEL SECURITY;

COMMIT;
