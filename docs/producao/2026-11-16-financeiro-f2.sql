-- Financeiro completo, fase 2 (contas e movimentos): banco de produção (Supabase).
-- Só acrescenta: a tabela de pedidos de liberação (vazia) e um índice nos movimentos.
-- Nenhum dado existente muda.
BEGIN;

-- CreateTable
CREATE TABLE "financial_releases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "titleId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_releases_tenantId_status_createdAt_idx" ON "financial_releases"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "financial_releases_tenantId_requestedById_idx" ON "financial_releases"("tenantId", "requestedById");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_mirrorPaymentId_idx" ON "financial_transactions"("tenantId", "mirrorPaymentId");

-- AddForeignKey
ALTER TABLE "financial_releases" ADD CONSTRAINT "financial_releases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_releases" ENABLE ROW LEVEL SECURITY;

COMMIT;
