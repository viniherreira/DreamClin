-- Agenda, fase 4 (situação, cancelamento com motivo e remarcação): banco de produção.
-- Só acrescenta: duas colunas vazias em appointments e duas tabelas vazias. Nenhum dado existente muda.
BEGIN;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "cancelReasonId" TEXT,
ADD COLUMN     "confirmationSource" TEXT;

-- CreateTable
CREATE TABLE "cancel_reasons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancel_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_reschedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fromStart" TIMESTAMP(3) NOT NULL,
    "fromEnd" TIMESTAMP(3) NOT NULL,
    "fromProfessionalId" TEXT,
    "toStart" TIMESTAMP(3) NOT NULL,
    "toEnd" TIMESTAMP(3) NOT NULL,
    "toProfessionalId" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AGENDA',
    "patientAsked" BOOLEAN NOT NULL DEFAULT false,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cancel_reasons_tenantId_order_idx" ON "cancel_reasons"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "cancel_reasons_tenantId_name_key" ON "cancel_reasons"("tenantId", "name");

-- CreateIndex
CREATE INDEX "appointment_reschedules_tenantId_appointmentId_idx" ON "appointment_reschedules"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "appointment_reschedules_tenantId_patientId_idx" ON "appointment_reschedules"("tenantId", "patientId");

-- AddForeignKey
ALTER TABLE "cancel_reasons" ADD CONSTRAINT "cancel_reasons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "cancel_reasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_reschedules" ENABLE ROW LEVEL SECURITY;

COMMIT;
