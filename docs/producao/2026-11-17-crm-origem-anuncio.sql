-- CRM: origem do lead pelo anúncio (dados da Meta, não o texto da conversa).
-- Banco de produção (Supabase). Só acrescenta: colunas vazias no lead e uma
-- tabela nova vazia com o assunto de cada anúncio. Nenhum dado existente muda.
-- A origem dos leads antigos é preenchida pelo próprio sistema, só nas colunas novas.
BEGIN;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "originAdId" TEXT,
ADD COLUMN IF NOT EXISTS "originAdName" TEXT,
ADD COLUMN IF NOT EXISTS "originAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "originCampaignId" TEXT,
ADD COLUMN IF NOT EXISTS "originCampaignName" TEXT,
ADD COLUMN IF NOT EXISTS "originHeadline" TEXT,
ADD COLUMN IF NOT EXISTS "originImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "originTopic" TEXT;

CREATE TABLE "ad_topics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "procedureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_topics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_topics_tenantId_scope_externalId_key" ON "ad_topics"("tenantId", "scope", "externalId");
CREATE INDEX "leads_tenantId_originAdId_idx" ON "leads"("tenantId", "originAdId");
CREATE INDEX "leads_tenantId_originCampaignId_idx" ON "leads"("tenantId", "originCampaignId");

ALTER TABLE "ad_topics" ADD CONSTRAINT "ad_topics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_topics" ENABLE ROW LEVEL SECURITY;

COMMIT;
