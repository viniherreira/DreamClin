-- Financeiro completo, fase 7 (conciliação): banco de produção (Supabase).
-- Só acrescenta: duas tabelas vazias (extratos importados e as linhas deles).
-- Nenhum dado existente muda.
BEGIN;

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "periodFrom" DATE,
    "periodTo" DATE,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statement_imports_tenantId_accountId_createdAt_idx" ON "bank_statement_imports"("tenantId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "bank_statement_lines_tenantId_accountId_status_date_idx" ON "bank_statement_lines"("tenantId", "accountId", "status", "date");

-- CreateIndex
CREATE INDEX "bank_statement_lines_tenantId_transactionId_idx" ON "bank_statement_lines"("tenantId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_tenantId_accountId_externalId_key" ON "bank_statement_lines"("tenantId", "accountId", "externalId");

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_statement_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY;

COMMIT;
