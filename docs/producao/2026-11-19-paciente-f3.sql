-- Paciente e agenda, fase 3 (documentos, assinaturas, anexos e questionários): banco de produção.
-- Só acrescenta: três colunas com padrão em patient_files (os anexos de antes continuam clínicos)
-- e sete tabelas vazias. Nenhum dado existente muda.
BEGIN;

-- AlterTable
ALTER TABLE "patient_files" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "clinical" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clinical" BOOLEAN NOT NULL DEFAULT false,
    "professionalId" TEXT,
    "appointmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "refuseReason" TEXT,
    "method" TEXT,
    "drawing" TEXT,
    "signerName" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "pdfHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_folders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clinical" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "folderId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploads" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaires" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "health" BOOLEAN NOT NULL DEFAULT true,
    "questions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "answers" JSONB,
    "appointmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_templates_tenantId_kind_idx" ON "document_templates"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "patient_documents_tenantId_patientId_createdAt_idx" ON "patient_documents"("tenantId", "patientId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "signature_requests_token_key" ON "signature_requests"("token");

-- CreateIndex
CREATE INDEX "signature_requests_tenantId_patientId_idx" ON "signature_requests"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "patient_folders_tenantId_patientId_idx" ON "patient_folders"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_folders_tenantId_patientId_name_key" ON "patient_folders"("tenantId", "patientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_token_key" ON "upload_sessions"("token");

-- CreateIndex
CREATE INDEX "upload_sessions_tenantId_patientId_idx" ON "upload_sessions"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "questionnaires_tenantId_idx" ON "questionnaires"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_requests_token_key" ON "questionnaire_requests"("token");

-- CreateIndex
CREATE INDEX "questionnaire_requests_tenantId_patientId_idx" ON "questionnaire_requests"("tenantId", "patientId");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "patient_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_folders" ADD CONSTRAINT "patient_folders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_requests" ADD CONSTRAINT "questionnaire_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_requests" ADD CONSTRAINT "questionnaire_requests_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "questionnaires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "questionnaires" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "questionnaire_requests" ENABLE ROW LEVEL SECURITY;

COMMIT;
