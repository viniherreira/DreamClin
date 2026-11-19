-- Paciente e agenda, fase 1 (cadastro completo do paciente): banco de produção (Supabase).
-- Só acrescenta: colunas opcionais em patients (as que não aceitam vazio já nascem com padrão)
-- e três tabelas vazias (origens, convênios do paciente e informações adicionais).
-- Nenhum dado existente muda.
BEGIN;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "birthdayMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bloodType" TEXT,
ADD COLUMN     "cns" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "education" TEXT,
ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "financialResponsibleId" TEXT,
ADD COLUMN     "financialResponsibleText" TEXT,
ADD COLUMN     "foreign_doc" TEXT,
ADD COLUMN     "foreigner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "genderIdentity" TEXT,
ADD COLUMN     "hobby" TEXT,
ADD COLUMN     "landline" TEXT,
ADD COLUMN     "landlineExt" TEXT,
ADD COLUMN     "legalGuardian" TEXT,
ADD COLUMN     "motherName" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "originId" TEXT,
ADD COLUMN     "other_contacts" TEXT,
ADD COLUMN     "photoPath" TEXT,
ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priorityType" TEXT,
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "rgIssuer" TEXT,
ADD COLUMN     "socialName" TEXT,
ADD COLUMN     "spouseName" TEXT;

-- CreateTable
CREATE TABLE "patient_origins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_insurances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "insurerId" TEXT,
    "insurerName" TEXT NOT NULL,
    "planName" TEXT,
    "cardNumber" TEXT,
    "validUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_insurances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_custom_fields" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "hasNote" BOOLEAN NOT NULL DEFAULT false,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_origins_tenantId_order_idx" ON "patient_origins"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "patient_origins_tenantId_name_key" ON "patient_origins"("tenantId", "name");

-- CreateIndex
CREATE INDEX "patient_insurances_tenantId_patientId_idx" ON "patient_insurances"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "patient_insurances_tenantId_insurerName_idx" ON "patient_insurances"("tenantId", "insurerName");

-- CreateIndex
CREATE INDEX "patient_custom_fields_tenantId_order_idx" ON "patient_custom_fields"("tenantId", "order");

-- CreateIndex
CREATE INDEX "patients_tenantId_financialResponsibleId_idx" ON "patients"("tenantId", "financialResponsibleId");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_originId_fkey" FOREIGN KEY ("originId") REFERENCES "patient_origins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_origins" ADD CONSTRAINT "patient_origins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurances" ADD CONSTRAINT "patient_insurances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurances" ADD CONSTRAINT "patient_insurances_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_custom_fields" ADD CONSTRAINT "patient_custom_fields_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "patient_origins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_insurances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_custom_fields" ENABLE ROW LEVEL SECURITY;

COMMIT;
