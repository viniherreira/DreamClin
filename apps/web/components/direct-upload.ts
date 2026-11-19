/**
 * Envio direto ao armazenamento (navegador → Supabase), usado nos anexos do
 * paciente e no "Enviar pelo celular": pede o endereço ao servidor, manda o
 * arquivo e avisa o servidor para conferir e registrar.
 */
export async function directUpload(
  file: File,
  start: (meta: { name: string; type: string; size: number }) => Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }>,
  finish: (meta: { path: string; name: string; type: string }) => Promise<{ ok: true } | { ok: false; message: string }>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const s = await start({ name: file.name, type: file.type, size: file.size });
  if (!s.ok) return s;
  const res = await fetch(s.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file }).catch(() => null);
  if (!res || !res.ok) return { ok: false, message: 'O envio falhou. Confira a internet e tente de novo.' };
  return finish({ path: s.path, name: file.name, type: file.type });
}
