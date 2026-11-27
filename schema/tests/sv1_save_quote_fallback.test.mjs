// SV1 app fallback. Stubbed rpc only. No database and no live Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { quoteSaveFnMissing, runExistingQuoteSave } from '../../src/quote.js';

const quoteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload = { notes: 'ZZ note', status: 'draft' };
const lines = [{ quote_id: quoteId, line_no: 1, qty: 2, unit_price: 5, name: 'ZZ widget' }];

function harness(rpcResult) {
  const calls = [];
  const shown = [];
  const run = runExistingQuoteSave({
    rpc: async (name, args) => {
      calls.push({ kind: 'rpc', name, args });
      if (rpcResult && rpcResult.throw) throw rpcResult.throw;
      return rpcResult.returns;
    },
    replaceQuoteLines: async (id) => {
      calls.push({ kind: 'quote_lines', id });
      return rpcResult.lineErr || null;
    },
    writeQuoteHeader: async (id) => {
      calls.push({ kind: 'quotes', id });
      return { error: rpcResult.headerErr || null };
    },
    showQuoteSaveError: (error, kind) => {
      shown.push({ error, kind });
    },
    quoteId,
    payload,
    lines
  });
  return { run, calls, shown };
}

test('shop_save_quote present: one rpc, no quote_lines or quotes writes', async () => {
  const { run, calls, shown } = harness({
    returns: { data: { id: quoteId, number: 'Q-L00001', status: 'draft' }, error: null }
  });
  assert.equal(await run, true);
  assert.deepEqual(calls.map(c => c.kind), ['rpc']);
  assert.equal(calls[0].name, 'shop_save_quote');
  assert.equal(calls[0].args.p_quote_id, quoteId);
  assert.equal(calls[0].args.p_quote, payload);
  assert.equal(calls[0].args.p_lines, lines);
  assert.deepEqual(shown, []);
  console.log('PASS function present: one rpc shop_save_quote, no quote_lines or quotes writes');
});

test('only PGRST202 or "could not find the function" falls back to lines then header', async () => {
  const cases = [
    { label: 'PGRST202 code', error: { code: 'PGRST202', message: 'schema cache miss' } },
    { label: 'could not find the function', error: { message: 'Could not find the function public.shop_save_quote(uuid, jsonb, jsonb) in the schema cache' } },
    { label: 'phrase in details, any case', error: { message: '', details: 'COULD NOT FIND THE FUNCTION shop_save_quote' } }
  ];
  for (const c of cases) {
    assert.equal(quoteSaveFnMissing(c.error), true, c.label);
    const { run, calls, shown } = harness({ returns: { data: null, error: c.error } });
    assert.equal(await run, true, c.label);
    assert.deepEqual(calls.map(call => call.kind), ['rpc', 'quote_lines', 'quotes'], c.label);
    assert.deepEqual(shown, [], c.label);
    console.log(`PASS fallback ${c.label}: quote_lines then quotes`);
  }
});

test('a fallback line error does not write the header', async () => {
  const lineErr = { message: 'line failed' };
  const { run, calls, shown } = harness({
    returns: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
    lineErr
  });
  assert.equal(await run, false);
  assert.deepEqual(calls.map(c => c.kind), ['rpc', 'quote_lines']);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].error, lineErr);
  assert.equal(shown[0].kind, 'before-header');
  console.log('PASS fallback line error: showQuoteSaveError before-header, header not written');
});

test('a fallback header error uses the header kind', async () => {
  const headerErr = { message: 'header failed' };
  const { run, calls, shown } = harness({
    returns: { data: null, error: { message: 'could not find the function public.shop_save_quote' } },
    headerErr
  });
  assert.equal(await run, false);
  assert.deepEqual(calls.map(c => c.kind), ['rpc', 'quote_lines', 'quotes']);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].error, headerErr);
  assert.equal(shown[0].kind, 'header');
  console.log('PASS fallback header error: showQuoteSaveError header');
});

test('network, timeout, 5xx, and P0001 do not fall back', async () => {
  const cases = [
    { label: 'network failure', error: { message: 'Failed to fetch', name: 'TypeError' } },
    { label: 'timeout', error: { message: 'Request timed out', code: '57014' } },
    { label: '5xx', error: { message: 'Internal Server Error', status: 500, code: '500' } },
    {
      label: 'P0001',
      error: {
        code: 'P0001',
        message: "Q-L00001 has approved invoice I-L00001. Its lines can't change. Void the invoice first to change them."
      }
    },
    { label: 'thrown network failure', throw: Object.assign(new TypeError('Failed to fetch'), { code: '' }) }
  ];
  for (const c of cases) {
    const error = c.throw || c.error;
    assert.equal(quoteSaveFnMissing(error), false, c.label);
    const { run, calls, shown } = harness(c.throw ? { throw: c.throw } : { returns: { data: null, error: c.error } });
    assert.equal(await run, false, c.label);
    assert.deepEqual(calls.map(call => call.kind), ['rpc'], c.label);
    assert.equal(shown.length, 1, c.label);
    assert.equal(shown[0].error, error, c.label);
    assert.equal(shown[0].kind, 'before-header', c.label);
    console.log(`PASS ${c.label}: showQuoteSaveError before-header, returned false, no fallback`);
  }
});

test('a nearby "could not find" message is not the missing-function fallback', async () => {
  const error = { code: 'PGRST204', message: 'Could not find the table public.quotes in the schema cache' };
  assert.equal(quoteSaveFnMissing(error), false);
  const { run, calls } = harness({ returns: { data: null, error } });
  assert.equal(await run, false);
  assert.deepEqual(calls.map(c => c.kind), ['rpc']);
  console.log('PASS "could not find the table" does not fall back');
});

test('the two existing-quote branches call saveExistingQuote, and the locked sentences are present', () => {
  const src = fs.readFileSync(new URL('../../src/quote.js', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf('const sealingVoid'), src.indexOf('if (!firstSave)'));
  const calls = branch.match(/saveExistingQuote\(quoteId, payload\)/g) || [];
  assert.equal(calls.length, 2);
  assert.equal((branch.match(/replaceQuoteLines\(/g) || []).length, 0);
  assert.equal((branch.match(/writeQuoteHeader\(/g) || []).length, 0);
  assert.match(branch, /quoteId && sealingVoid/);
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('This quote is missing\\. It was not saved\\.'));
  assert.ok(html.includes('The quote was not saved and no number was used\\.'));
  assert.ok(html.includes("The quote was not saved\\.)"));
  console.log('PASS both existing-quote branches call saveExistingQuote; locked sentences are in index.html');
});
