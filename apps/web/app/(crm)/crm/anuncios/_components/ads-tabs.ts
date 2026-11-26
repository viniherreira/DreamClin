/** As abas de Anúncios: uma por gerenciador conectável. Com uma só, o topo não mostra abas. */
export type AdsTab = 'meta' | 'google';

export function adsTabs(active: AdsTab, googleOn: boolean): { href: string; label: string; active: boolean }[] {
  const tabs = [{ href: '/crm/anuncios', label: 'Meta', active: active === 'meta' }];
  if (googleOn) tabs.push({ href: '/crm/anuncios/google', label: 'Google', active: active === 'google' });
  return tabs;
}
