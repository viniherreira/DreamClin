-- Agenda, fase 6 (confirmações, lista de espera, horários livres, alterações em massa e meu dia): banco de produção.
-- Só acrescenta: uma tabela vazia (lista de espera) com RLS ligado.
BEGIN;

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "professionalId" TEXT,
    "careTypeId" TEXT,
    "procedureId" TEXT,
    "period" TEXT NOT NULL DEFAULT 'ANY',
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "fromDate" TIMESTAMP(3),
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "removedReason" TEXT,
    "appointmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entries_tenantId_status_createdAt_idx" ON "waitlist_entries"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "waitlist_entries_tenantId_patientId_idx" ON "waitlist_entries"("tenantId", "patientId");

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;

COMMIT;
