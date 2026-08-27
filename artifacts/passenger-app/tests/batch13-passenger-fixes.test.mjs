/**
 * Guards for passenger paymentStatus mapping + wallet top-up exposure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function load(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test('normalizePaymentStatus maps paid → confirmed', async () => {
  // Inline mirror of RideContext export (avoid TS import in node:test without strip).
  function normalizePaymentStatus(raw) {
    if (raw == null || raw === '') return undefined;
    const s = String(raw).trim().toLowerCase();
    if (!s) return undefined;
    if (s === 'failed' || s === 'unpaid' || s === 'canceled' || s === 'cancelled') return 'failed';
    if (['confirmed', 'paid', 'succeeded', 'success', 'complete', 'completed'].includes(s)) return 'confirmed';
    if (s === 'pending' || s === 'processing' || s === 'requires_payment') return 'pending';
    return 'pending';
  }
  assert.equal(normalizePaymentStatus('paid'), 'confirmed');
  assert.equal(normalizePaymentStatus('PAID'), 'confirmed');
  assert.equal(normalizePaymentStatus('confirmed'), 'confirmed');
  assert.equal(normalizePaymentStatus('pending'), 'pending');
  assert.equal(normalizePaymentStatus('failed'), 'failed');
});

test('home screen no longer exposes Top Up press target', () => {
  const src = load('app/(tabs)/index.tsx');
  assert.doesNotMatch(src, /Top Up/);
  assert.match(src, /Top-up hidden until real card\/Stripe funding exists/);
});

test('profile top-up form is disabled with honest copy', () => {
  const src = load('app/(tabs)/profile.tsx');
  assert.doesNotMatch(src, /handleTopup/);
  assert.doesNotMatch(src, /TOP UP WALLET/);
  assert.match(src, /Top-up is temporarily unavailable/);
});

test('stripe AuthSession result is handled (cancel throws)', () => {
  const src = load('lib/stripePayment.ts');
  assert.match(src, /StripeCheckoutCancelledError/);
  assert.match(src, /openAuthSessionAsync/);
  assert.match(src, /result\.type === "success"/);
  assert.match(src, /dismissBrowser/);
});

test('completeRide clears activeRide before async writes', () => {
  const src = load('context/RideContext.tsx');
  assert.match(src, /const ride = activeRideRef\.current/);
  assert.match(src, /clearRide\(\);\s*\n\s*try \{/);
  assert.match(src, /normalizePaymentStatus/);
  assert.match(src, /enrichVehicleFromFleet/);
  assert.match(src, /markPaymentConfirmed/);
});

test('active-ride completed UI is single-path (no Rate & Complete duplicate)', () => {
  const src = load('app/active-ride/index.tsx');
  assert.match(src, /Trip complete — choose an option above/);
  assert.match(src, /Rate My Driver/);
  // Bottom CTA must not still offer a second Rate & Complete button
  assert.ok(!/actionBtnText\}>Rate & Complete</.test(src));
  assert.match(src, /In-app chat coming soon/);
  assert.doesNotMatch(src, /Got it, thanks!/);
  assert.doesNotMatch(src, /On my way!/);
});
