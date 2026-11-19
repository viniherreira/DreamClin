-- Paciente e agenda, fase 2 (perfil do paciente): banco de produção (Supabase).
-- Só acrescenta: colunas com padrão em patient_notes, "cancelledBy" em appointments
-- e três tabelas vazias (linha do tempo e planos de tratamento). Nenhum dado existente muda.
BEGIN;

-- AlterTable
ALTER TABLE "patient_notes" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showInAgenda" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancelledBy" TEXT;

-- CreateTable
CREATE TABLE "patient_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "professionalId" TEXT,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "closedAt" TIMESTAMP(3),
    "quoteId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatment_plan_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "findingId" TEXT,
    "procedureId" TEXT,
    "description" TEXT NOT NULL,
    "teeth" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_events_tenantId_patientId_at_idx" ON "patient_events"("tenantId", "patientId", "at" DESC);

-- CreateIndex
CREATE INDEX "patient_events_tenantId_refType_refId_idx" ON "patient_events"("tenantId", "refType", "refId");

-- CreateIndex
CREATE INDEX "treatment_plans_tenantId_patientId_idx" ON "treatment_plans"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_plans_tenantId_number_key" ON "treatment_plans"("tenantId", "number");

-- CreateIndex
CREATE INDEX "treatment_plan_items_tenantId_planId_idx" ON "treatment_plan_items"("tenantId", "planId");

-- AddForeignKey
ALTER TABLE "patient_events" ADD CONSTRAINT "patient_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_events" ADD CONSTRAINT "patient_events_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "patient_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatment_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "treatment_plan_items" ENABLE ROW LEVEL SECURITY;

COMMIT;
