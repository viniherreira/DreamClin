-- Agenda, fase 4b (tipos de atendimento, salas e equipamentos, feriados e repetição): banco de produção.
-- Só acrescenta: quatro colunas vazias em appointments, dois índices e três tabelas vazias.
BEGIN;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "agendaId" TEXT,
ADD COLUMN     "careTypeId" TEXT,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "seriesIndex" INTEGER;

-- CreateTable
CREATE TABLE "care_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "allowOverlap" BOOLEAN NOT NULL DEFAULT false,
    "chargeable" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_resources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'teal',
    "unitId" TEXT,
    "allowOverlap" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_types_tenantId_order_idx" ON "care_types"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "care_types_tenantId_name_key" ON "care_types"("tenantId", "name");

-- CreateIndex
CREATE INDEX "agenda_resources_tenantId_order_idx" ON "agenda_resources"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_resources_tenantId_name_key" ON "agenda_resources"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenantId_date_key" ON "holidays"("tenantId", "date");

-- CreateIndex
CREATE INDEX "appointments_tenantId_seriesId_idx" ON "appointments"("tenantId", "seriesId");

-- CreateIndex
CREATE INDEX "appointments_tenantId_agendaId_startTime_idx" ON "appointments"("tenantId", "agendaId", "startTime");

-- AddForeignKey
ALTER TABLE "care_types" ADD CONSTRAINT "care_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_resources" ADD CONSTRAINT "agenda_resources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "care_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenda_resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;

COMMIT;
