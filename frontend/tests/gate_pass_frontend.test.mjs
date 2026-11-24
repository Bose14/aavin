import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');

test('1. Gate Pass routing and navigation configuration', () => {
  const appPath = path.join(frontendDir, 'src', 'App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');
  assert.ok(appContent.includes('/qc/gate-pass'), 'App.tsx must define /qc/gate-pass route');
  assert.ok(appContent.includes('activeView="gate-pass"'), 'App.tsx must pass activeView="gate-pass" to QCLab');

  const layoutPath = path.join(frontendDir, 'src', 'components', 'Layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  assert.ok(layoutContent.includes('/qc/gate-pass'), 'Layout.tsx must include /qc/gate-pass navigation item');
  assert.ok(layoutContent.includes('navGatePass'), 'Layout.tsx must use navGatePass label key');
});

test('2. Gate Pass translations in English and Tamil', () => {
  const transPath = path.join(frontendDir, 'src', 'i18n', 'translations.ts');
  const transContent = fs.readFileSync(transPath, 'utf8');
  assert.ok(transContent.includes('navGatePass: \'Gate Pass\''), 'English translation must define navGatePass');
  assert.ok(transContent.includes('வாயில் அனுமதிச் சீட்டு'), 'Tamil translation must define Gate Pass translation');
});

test('3. QCLab Gate Pass sub-tab, queue conditions and authentic yellow modal slip', () => {
  const qcPath = path.join(frontendDir, 'src', 'pages', 'plant', 'QCLab.tsx');
  const qcContent = fs.readFileSync(qcPath, 'utf8');

  // Prop & view state
  assert.ok(qcContent.includes("'gate-pass'"), 'QCLab must support gate-pass view');
  assert.ok(qcContent.includes('gatePassWaiters'), 'QCLab must compute gatePassWaiters');
  assert.ok(qcContent.includes('issuedGatePasses'), 'QCLab must compute issuedGatePasses register');

  // CIP completion condition check
  assert.ok(
    qcContent.includes("cip_status === 'pass'") || qcContent.includes("qc_inspection === 'SATISFIED'"),
    'Gate Pass queue must require CIP completion with pass/satisfied'
  );

  // PDF Export integration
  assert.ok(qcContent.includes('/export/gate-pass/'), 'QCLab must call /export/gate-pass/:id for PDF export');

  // Modal voucher slip layout matching user photo
  assert.ok(qcContent.includes('#fef9c3'), 'Modal voucher must use Canary yellow background matching photo');
  assert.ok(qcContent.includes('NAMAKKAL MILK UNION'), 'Modal voucher must contain union title from photo');
  assert.ok(qcContent.includes('GATE PASS'), 'Modal voucher must contain GATE PASS header from photo');
  assert.ok(qcContent.includes('Whether returnable'), 'Modal voucher must have Whether returnable column');
  assert.ok(qcContent.includes('EMPTY TANKER'), 'Modal voucher must default item to EMPTY TANKER');
  assert.ok(qcContent.includes('TO BMC'), 'Modal voucher must default purpose to TO BMC');
  assert.ok(qcContent.includes('Issuing Officer'), 'Modal voucher must have Issuing Officer signature');
  assert.ok(qcContent.includes('Security'), 'Modal voucher must have Security signature');
});

test('4. GateOperations requires Gate Pass before allowing vehicle exit (Tanker Out)', () => {
  const gatePath = path.join(frontendDir, 'src', 'pages', 'plant', 'GateOperations.tsx');
  const gateContent = fs.readFileSync(gatePath, 'utf8');

  assert.ok(gateContent.includes('gatePassDone'), 'GateOperations must compute gatePassDone');
  assert.ok(
    gateContent.includes('((cipDone && gatePassDone) || isQcRej)'),
    'Vehicle exit must require (CIP done AND gate pass done) OR QC rejection before allowing exit'
  );
  assert.ok(gateContent.includes('№'), 'GateOperations must display Gate Pass serial number badge');
});
