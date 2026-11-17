-- Financeiro completo, fase 1 (fundação): banco de produção (Supabase).
-- Só acrescenta: 19 tabelas novas (vazias), os tipos delas e 4 colunas vazias em "appointments".
-- Nenhum paciente, agendamento, orçamento ou pagamento muda.
-- As contas, categorias e formas padrão de cada clínica são criadas pelo sistema
-- na primeira vez que a clínica abre o financeiro novo (hoje, só a conta em cortesia).
-- Toda tabela nasce com RLS ligado e sem política: só o sistema lê.
-- Rodar inteiro (numa transação: ou entra tudo, ou nada).
BEGIN;

-- CreateEnum
CREATE TYPE "FinDirection" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "FinTitleStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED', 'RENEGOTIATED');

-- CreateEnum
CREATE TYPE "FinOrigin" AS ENUM ('MANUAL', 'APPOINTMENT', 'QUOTE', 'COMMISSION', 'CARD_FEE', 'RENEGOTIATION', 'WALLET', 'RECURRENCE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinAccountKind" AS ENUM ('CASH', 'BANK', 'DIGITAL');

-- CreateEnum
CREATE TYPE "FinMethodKind" AS ENUM ('CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'CHECK', 'WALLET', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "FinTxKind" AS ENUM ('RECEIPT', 'PAYMENT', 'REINFORCEMENT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL', 'FEE');

-- CreateEnum
CREATE TYPE "FinContactKind" AS ENUM ('SUPPLIER', 'INSURANCE', 'CARD_OPERATOR', 'THIRD_PARTY', 'OTHER');

-- CreateEnum
CREATE TYPE "DreLine" AS ENUM ('RECEITA_BRUTA', 'IMPOSTOS', 'DEDUCOES_RECEITA', 'OUTRAS_RECEITAS', 'OUTRAS_DEDUCOES', 'CUSTO_SERVICOS', 'CUSTO_PRODUTOS', 'OUTROS_CUSTOS', 'DESPESAS_VARIAVEIS', 'RECUPERACAO_VARIAVEIS', 'DESPESAS_PESSOAL', 'DESPESAS_ADMINISTRATIVAS', 'DESPESAS_FINANCEIRAS', 'RECUPERACAO_FIXAS', 'OUTROS_TRIBUTOS', 'INVESTIMENTOS_ATIVOS', 'INVESTIMENTOS_SERVICOS', 'PROVISAO_IR_CSLL', 'PARTICIPACOES');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WalletReason" AS ENUM ('ADVANCE', 'CHANGE', 'REVERSAL', 'RENEGOTIATION', 'USE', 'REFUND');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('NONE', 'TO_RECEIVE', 'BILLED', 'PARTIAL', 'PAID', 'NO_CHARGE');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "billingStatus" "BillingStatus",
ADD COLUMN     "noChargeAt" TIMESTAMP(3),
ADD COLUMN     "noChargeById" TEXT,
ADD COLUMN     "noChargeReason" TEXT;

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinAccountKind" NOT NULL DEFAULT 'CASH',
    "bankName" TEXT,
    "agency" TEXT,
    "number" TEXT,
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openingDate" DATE NOT NULL,
    "unitId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "direction" "FinDirection" NOT NULL,
    "dreLine" "DreLine",
    "comment" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personType" TEXT NOT NULL DEFAULT 'PJ',
    "document" TEXT,
    "documentHash" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "zipCode" TEXT,
    "street" TEXT,
    "addressNumber" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "kind" "FinContactKind" NOT NULL DEFAULT 'SUPPLIER',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_payment_methods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinMethodKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usage" TEXT NOT NULL DEFAULT 'BOTH',
    "accountId" TEXT,
    "requireDocNumber" BOOLEAN NOT NULL DEFAULT false,
    "settlementType" TEXT NOT NULL DEFAULT 'SAME_DAY',
    "settlementValue" INTEGER,
    "operatorContactId" TEXT,
    "maxInstallments" INTEGER NOT NULL DEFAULT 1,
    "feeCategoryId" TEXT,
    "feeCostCenterId" TEXT,
    "anticipation" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_payment_method_fees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "upToInstallments" INTEGER NOT NULL,
    "percent" DECIMAL(6,3),
    "fixed" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_payment_method_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_titles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "direction" "FinDirection" NOT NULL,
    "origin" "FinOrigin" NOT NULL DEFAULT 'MANUAL',
    "originId" TEXT,
    "patientId" TEXT,
    "contactId" TEXT,
    "professionalId" TEXT,
    "unitId" TEXT,
    "appointmentId" TEXT,
    "quoteId" TEXT,
    "categoryId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "accountId" TEXT,
    "methodId" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "competence" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FinTitleStatus" NOT NULL DEFAULT 'OPEN',
    "installmentNumber" INTEGER NOT NULL DEFAULT 1,
    "installmentTotal" INTEGER NOT NULL DEFAULT 1,
    "groupId" TEXT,
    "recurrenceId" TEXT,
    "renegotiationId" TEXT,
    "document" TEXT,
    "documentNumber" TEXT,
    "description" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_title_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_title_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "kind" "FinTxKind" NOT NULL,
    "origin" "FinOrigin" NOT NULL DEFAULT 'MANUAL',
    "originId" TEXT,
    "titleId" TEXT,
    "accountId" TEXT,
    "cashSessionId" TEXT,
    "methodId" TEXT,
    "methodKind" "FinMethodKind",
    "patientId" TEXT,
    "contactId" TEXT,
    "categoryId" TEXT,
    "costCenterId" TEXT,
    "document" TEXT,
    "documentNumber" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "signedAmount" DECIMAL(12,2) NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "cardBrand" TEXT,
    "nsu" TEXT,
    "checkBank" TEXT,
    "checkNumber" TEXT,
    "checkHolder" TEXT,
    "checkDate" DATE,
    "paidOn" DATE NOT NULL,
    "competence" TEXT NOT NULL,
    "settlementDate" DATE,
    "receiptGroupId" TEXT,
    "transferId" TEXT,
    "reversalOfId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "statementLineId" TEXT,
    "legacyPaymentId" TEXT,
    "mirrorPaymentId" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_receivables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "methodId" TEXT,
    "operatorContactId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'CARD',
    "installmentNumber" INTEGER NOT NULL DEFAULT 1,
    "installmentTotal" INTEGER NOT NULL DEFAULT 1,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "expectedDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reconciledAt" TIMESTAMP(3),
    "anticipatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT,
    "accountId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "blind" BOOLEAN NOT NULL DEFAULT false,
    "difference" DECIMAL(12,2),
    "closingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "methodKind" "FinMethodKind" NOT NULL,
    "expected" DECIMAL(12,2) NOT NULL,
    "counted" DECIMAL(12,2) NOT NULL,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_session_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" "WalletReason" NOT NULL,
    "titleId" TEXT,
    "transactionId" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renegotiations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "patientId" TEXT,
    "contactId" TEXT,
    "originalTotal" DECIMAL(12,2) NOT NULL,
    "correctedTotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "downPayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "interestPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "interestMode" TEXT NOT NULL DEFAULT 'SIMPLE',
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renegotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renegotiation_titles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "renegotiationId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "previousStatus" "FinTitleStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renegotiation_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "every" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'MONTH',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "occurrences" INTEGER,
    "template" JSONB NOT NULL,
    "generatedUntil" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "procedureId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "quoteItemId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_permissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxDiscountPercent" DECIMAL(5,2),
    "operation" TEXT NOT NULL DEFAULT 'BOTH',
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canReverse" BOOLEAN,
    "canSeeReports" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titleId" TEXT,
    "transactionId" TEXT,
    "bucketPath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_tenantId_active_idx" ON "financial_accounts"("tenantId", "active");

-- CreateIndex
CREATE INDEX "financial_categories_tenantId_direction_active_idx" ON "financial_categories"("tenantId", "direction", "active");

-- CreateIndex
CREATE INDEX "financial_categories_tenantId_parentId_idx" ON "financial_categories"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_tenantId_systemKey_key" ON "financial_categories"("tenantId", "systemKey");

-- CreateIndex
CREATE INDEX "cost_centers_tenantId_parentId_idx" ON "cost_centers"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "fin_contacts_tenantId_name_idx" ON "fin_contacts"("tenantId", "name");

-- CreateIndex
CREATE INDEX "fin_contacts_tenantId_kind_active_idx" ON "fin_contacts"("tenantId", "kind", "active");

-- CreateIndex
CREATE INDEX "fin_contacts_tenantId_documentHash_idx" ON "fin_contacts"("tenantId", "documentHash");

-- CreateIndex
CREATE INDEX "fin_payment_methods_tenantId_active_order_idx" ON "fin_payment_methods"("tenantId", "active", "order");

-- CreateIndex
CREATE INDEX "fin_payment_method_fees_tenantId_methodId_idx" ON "fin_payment_method_fees"("tenantId", "methodId");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_direction_status_dueDate_idx" ON "financial_titles"("tenantId", "direction", "status", "dueDate");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_patientId_status_idx" ON "financial_titles"("tenantId", "patientId", "status");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_contactId_idx" ON "financial_titles"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_origin_originId_idx" ON "financial_titles"("tenantId", "origin", "originId");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_appointmentId_idx" ON "financial_titles"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_quoteId_idx" ON "financial_titles"("tenantId", "quoteId");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_competence_idx" ON "financial_titles"("tenantId", "competence");

-- CreateIndex
CREATE INDEX "financial_titles_tenantId_groupId_idx" ON "financial_titles"("tenantId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_titles_tenantId_code_key" ON "financial_titles"("tenantId", "code");

-- CreateIndex
CREATE INDEX "financial_title_allocations_tenantId_titleId_idx" ON "financial_title_allocations"("tenantId", "titleId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_reversalOfId_key" ON "financial_transactions"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_legacyPaymentId_key" ON "financial_transactions"("legacyPaymentId");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_paidOn_idx" ON "financial_transactions"("tenantId", "paidOn");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_accountId_paidOn_idx" ON "financial_transactions"("tenantId", "accountId", "paidOn");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_titleId_idx" ON "financial_transactions"("tenantId", "titleId");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_cashSessionId_idx" ON "financial_transactions"("tenantId", "cashSessionId");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_patientId_paidOn_idx" ON "financial_transactions"("tenantId", "patientId", "paidOn");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_receiptGroupId_idx" ON "financial_transactions"("tenantId", "receiptGroupId");

-- CreateIndex
CREATE INDEX "financial_transactions_tenantId_competence_idx" ON "financial_transactions"("tenantId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_tenantId_code_key" ON "financial_transactions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "card_receivables_tenantId_status_expectedDate_idx" ON "card_receivables"("tenantId", "status", "expectedDate");

-- CreateIndex
CREATE INDEX "card_receivables_tenantId_transactionId_idx" ON "card_receivables"("tenantId", "transactionId");

-- CreateIndex
CREATE INDEX "cash_sessions_tenantId_status_idx" ON "cash_sessions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_tenantId_userId_status_idx" ON "cash_sessions"("tenantId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_sessions_tenantId_code_key" ON "cash_sessions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "cash_session_counts_tenantId_sessionId_idx" ON "cash_session_counts"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "wallet_entries_tenantId_patientId_createdAt_idx" ON "wallet_entries"("tenantId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "renegotiations_tenantId_patientId_idx" ON "renegotiations"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "renegotiations_tenantId_code_key" ON "renegotiations"("tenantId", "code");

-- CreateIndex
CREATE INDEX "renegotiation_titles_tenantId_renegotiationId_idx" ON "renegotiation_titles"("tenantId", "renegotiationId");

-- CreateIndex
CREATE INDEX "renegotiation_titles_tenantId_titleId_idx" ON "renegotiation_titles"("tenantId", "titleId");

-- CreateIndex
CREATE INDEX "recurrence_rules_tenantId_active_idx" ON "recurrence_rules"("tenantId", "active");

-- CreateIndex
CREATE INDEX "appointment_items_tenantId_appointmentId_idx" ON "appointment_items"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "appointment_items_tenantId_quoteItemId_idx" ON "appointment_items"("tenantId", "quoteItemId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_permissions_userId_key" ON "financial_permissions"("userId");

-- CreateIndex
CREATE INDEX "financial_permissions_tenantId_idx" ON "financial_permissions"("tenantId");

-- CreateIndex
CREATE INDEX "financial_attachments_tenantId_titleId_idx" ON "financial_attachments"("tenantId", "titleId");

-- CreateIndex
CREATE INDEX "financial_attachments_tenantId_transactionId_idx" ON "financial_attachments"("tenantId", "transactionId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_billingStatus_startTime_idx" ON "appointments"("tenantId", "billingStatus", "startTime");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_contacts" ADD CONSTRAINT "fin_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_methods" ADD CONSTRAINT "fin_payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_methods" ADD CONSTRAINT "fin_payment_methods_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_method_fees" ADD CONSTRAINT "fin_payment_method_fees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_method_fees" ADD CONSTRAINT "fin_payment_method_fees_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "fin_payment_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "fin_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_titles" ADD CONSTRAINT "financial_titles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_title_allocations" ADD CONSTRAINT "financial_title_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_title_allocations" ADD CONSTRAINT "financial_title_allocations_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "financial_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "financial_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_receivables" ADD CONSTRAINT "card_receivables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_receivables" ADD CONSTRAINT "card_receivables_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session_counts" ADD CONSTRAINT "cash_session_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session_counts" ADD CONSTRAINT "cash_session_counts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiations" ADD CONSTRAINT "renegotiations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiation_titles" ADD CONSTRAINT "renegotiation_titles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renegotiation_titles" ADD CONSTRAINT "renegotiation_titles_renegotiationId_fkey" FOREIGN KEY ("renegotiationId") REFERENCES "renegotiations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_permissions" ADD CONSTRAINT "financial_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_attachments" ADD CONSTRAINT "financial_attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin_payment_method_fees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_titles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_title_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_receivables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_session_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "renegotiations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "renegotiation_titles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurrence_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_attachments" ENABLE ROW LEVEL SECURITY;

COMMIT;
