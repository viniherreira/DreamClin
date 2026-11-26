-- Tag do assunto do anúncio nos leads que já vieram por anúncio.
--
-- Daqui para frente o sistema faz sozinho (crm/origin.ts → tagAdTopic). Isto é
-- só para os leads antigos. Só ACRESCENTA: cria a tag quando não existe nenhuma
-- com o mesmo nome (sem contar acento, hífen e maiúscula) e liga a tag ao lead.
-- Não apaga nem muda nada que já existe.
--
-- ATENÇÃO: hoje os únicos leads com assunto são da clínica Odontologia Michele
-- Herreira (36 leads, assunto "Implante", e a tag "implante" já existe lá).
-- Só rodar com o "pode" do dono.

-- 1) A tag do assunto, quando a clínica ainda não tem uma com o mesmo nome.
WITH assuntos AS (
  SELECT DISTINCT l."tenantId", left(lower(trim(l."originTopic")), 30) AS nome
  FROM leads l
  WHERE l."originTopic" IS NOT NULL AND trim(l."originTopic") <> '' AND l."deletedAt" IS NULL
)
INSERT INTO lead_tags (id, "tenantId", name, color, "createdAt")
SELECT 'tag' || substr(md5(a."tenantId" || ':' || a.nome), 1, 22), a."tenantId", a.nome, 'violet', now()
FROM assuntos a
WHERE NOT EXISTS (
  SELECT 1 FROM lead_tags t
  WHERE t."tenantId" = a."tenantId"
    AND trim(regexp_replace(lower(translate(lower(t.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
      = trim(regexp_replace(lower(translate(lower(a.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
)
ON CONFLICT DO NOTHING;

-- 2) Liga a tag aos leads (a mais antiga, se houver duas com o mesmo nome).
INSERT INTO lead_tags_on_leads ("tenantId", "leadId", "tagId", "createdAt")
SELECT DISTINCT ON (l.id) l."tenantId", l.id, t.id, now()
FROM leads l
JOIN lead_tags t
  ON t."tenantId" = l."tenantId"
 AND trim(regexp_replace(lower(translate(lower(t.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
   = trim(regexp_replace(lower(translate(lower(l."originTopic"), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
WHERE l."originTopic" IS NOT NULL AND l."deletedAt" IS NULL
ORDER BY l.id, t."createdAt"
ON CONFLICT DO NOTHING;

-- 3) Conferência: leads com assunto e quantos já têm a tag dele.
SELECT l."originTopic" AS assunto,
       count(*) AS leads_com_assunto,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM lead_tags_on_leads x JOIN lead_tags t ON t.id = x."tagId"
         WHERE x."leadId" = l.id
           AND trim(regexp_replace(lower(translate(lower(t.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
             = trim(regexp_replace(lower(translate(lower(l."originTopic"), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
       )) AS com_a_tag
FROM leads l
WHERE l."originTopic" IS NOT NULL AND l."deletedAt" IS NULL
GROUP BY 1;
