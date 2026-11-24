-- Agenda, fase 7 (escalas: regras com vigência, folgas e plantões): banco de produção.
-- Só acrescenta: duas tabelas vazias com RLS ligado. Ninguém perde horário: sem escala nova, vale o horário de atendimento de sempre.
BEGIN;

-- CreateTable
CREATE TABLE "schedule_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "unitId" TEXT,
    "careTypeId" TEXT,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "repeat" TEXT NOT NULL DEFAULT 'WEEKLY',
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "everyDays" INTEGER,
    "monthDay" INTEGER,
    "start1" TEXT NOT NULL,
    "end1" TEXT NOT NULL,
    "start2" TEXT,
    "end2" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "start" TEXT,
    "end" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_rules_tenantId_professionalId_idx" ON "schedule_rules"("tenantId", "professionalId");

-- CreateIndex
CREATE INDEX "schedule_exceptions_tenantId_professionalId_date_idx" ON "schedule_exceptions"("tenantId", "professionalId", "date");

-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "schedule_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_exceptions" ENABLE ROW LEVEL SECURITY;

COMMIT;
