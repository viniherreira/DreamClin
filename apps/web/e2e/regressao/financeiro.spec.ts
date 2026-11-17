import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from '../support/helpers';

/**
 * Regressão do financeiro completo (fase 2): lançar uma conta, receber com
 * dois meios, abrir o recibo, estornar e lançar uma conta recorrente.
 *
 * O financeiro novo fica atrás de uma bandeira. Sem ela (o padrão dos testes),
 * /financeiro/contas volta para o financeiro antigo e estes testes são pulados.
 * Para ligar: FINANCEIRO_COMPLETO=todos em apps/web/.env.development.local.
 */

async function abreContas(page: Page): Promise<boolean> {
  await page.goto('/financeiro/contas');
  await page.waitForLoadState('networkidle');
  return /\/financeiro\/contas/.test(page.url());
}

/** Deixa na lista só as contas com esta descrição. */
async function filtraPorDescricao(page: Page, descricao: string) {
  await page.getByRole('button', { name: 'Mais filtros' }).click();
  const filtros = page.getByRole('dialog', { name: 'Mais filtros' });
  await filtros.getByLabel('Descrição').fill(descricao);
  await filtros.getByRole('button', { name: 'Filtrar' }).click();
  await expect(filtros).toBeHidden();
}

test('lança uma conta a receber, recebe em PIX e no cartão em 3x, abre o recibo e estorna', async ({ page }) => {
  test.skip(!(await abreContas(page)), 'Financeiro completo desligado neste ambiente.');
  const descricao = uniqueName('Conta E2E');

  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  const novo = page.getByRole('dialog', { name: 'Novo lançamento' });
  await novo.getByLabel('Categoria').selectOption({ index: 1 });
  await novo.getByLabel('Valor', { exact: true }).fill('300,00');
  await novo.getByLabel('Descrição (opcional)').fill(descricao);
  await novo.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Lançamento criado.' })).toBeVisible();

  await filtraPorDescricao(page, descricao);
  const linha = page.getByRole('row').filter({ hasText: descricao });
  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText('R$ 300,00');
  await linha.getByRole('button', { name: /^Receber a conta/ }).click();

  // Dois meios: R$ 100 no PIX e o resto no cartão de crédito em 3x.
  const receber = page.getByRole('dialog', { name: /^Receber · conta nº/ });
  await receber.getByLabel('Forma').selectOption({ label: 'PIX' });
  await receber.getByLabel('Valor', { exact: true }).fill('100,00');
  await receber.getByRole('button', { name: 'Adicionar outro meio' }).click();
  const cartao = receber.getByRole('group', { name: 'Meio 2' });
  await cartao.getByLabel('Forma').selectOption({ label: 'Cartão de crédito' });
  await cartao.getByLabel('Valor', { exact: true }).fill('200,00');
  await cartao.getByLabel('Parcelas').selectOption('3');
  await receber.getByRole('button', { name: /^Receber R\$\s?300,00/ }).click();

  const feito = page.getByRole('dialog', { name: 'Recebimento registrado' });
  await expect(feito.getByText('Conta quitada.')).toBeVisible();
  const recibo = feito.getByRole('link', { name: 'Recibo A4' });
  const href = await recibo.getAttribute('href');
  expect(href).toMatch(/^\/financeiro\/recibo\//);
  // O recibo sai em PDF nos dois formatos.
  for (const url of [href!, `${href}?formato=cupom`]) {
    const res = await page.request.get(url);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
  }
  await feito.getByRole('button', { name: 'Fechar' }).first().click();

  // Quitada: some da lista de "Em aberto" e aparece em "Pagas".
  await expect(page.getByRole('row').filter({ hasText: descricao })).toHaveCount(0);
  await page.getByLabel('Mostrar').selectOption('paid');
  const paga = page.getByRole('row').filter({ hasText: descricao });
  await expect(paga).toHaveCount(1);

  // Estorno do PIX pela ficha da conta: a conta reabre com R$ 100 em aberto.
  await paga.getByRole('button', { name: /^Ver a conta/ }).click();
  const ficha = page.getByRole('dialog').filter({ hasText: descricao });
  await ficha.getByRole('button', { name: /^Estornar o lançamento de/ }).first().click();
  const estorno = page.getByRole('dialog', { name: 'Estornar' });
  const motivo = uniqueName('Motivo E2E');
  await estorno.getByLabel('Motivo').fill(motivo);
  await estorno.getByRole('button', { name: 'Estornar', exact: true }).click();
  await expect(estorno).toBeHidden();

  await page.goto('/financeiro/estornos');
  await expect(page.getByRole('heading', { level: 1, name: 'Estornos' })).toBeVisible();
  await expect(page.getByText(motivo).first()).toBeVisible();
});

test('lança uma conta de luz recorrente e paga a primeira', async ({ page }) => {
  test.skip(!(await abreContas(page)), 'Financeiro completo desligado neste ambiente.');
  const descricao = uniqueName('Luz E2E');

  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  const novo = page.getByRole('dialog', { name: 'Novo lançamento' });
  await novo.getByRole('radio', { name: 'A pagar' }).click();
  await novo.getByLabel('Categoria').selectOption({ index: 1 });
  await novo.getByLabel('Valor', { exact: true }).fill('180,50');
  await novo.getByLabel('Descrição (opcional)').fill(descricao);
  await novo.getByLabel('Lançamento recorrente').check();
  await expect(novo.getByText(/Próximos vencimentos:/)).toBeVisible();
  await novo.getByRole('button', { name: 'Salvar' }).click();
  // Doze meses à frente, contando o de hoje.
  await expect(page.getByRole('status').filter({ hasText: /\d+ lançamentos criados\./ })).toBeVisible();

  await page.getByRole('tab', { name: 'A pagar' }).click();
  await filtraPorDescricao(page, descricao);
  const linha = page.getByRole('row').filter({ hasText: descricao }).first();
  await expect(linha.getByLabel('Recorrente')).toBeVisible();
  await linha.getByRole('button', { name: /^Pagar a conta/ }).click();

  const pagar = page.getByRole('dialog', { name: /^Pagar · conta nº/ });
  await pagar.getByLabel('Forma').selectOption({ label: 'PIX' });
  await pagar.getByRole('button', { name: /^Pagar R\$\s?180,50/ }).click();
  await expect(page.getByRole('dialog', { name: 'Pagamento registrado' }).getByText('Conta quitada.')).toBeVisible();
});
