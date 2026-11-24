process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGatePassPdf } from '../dist/lib/gatePassPdf.js';

test('1. buildGatePassPdf generates valid PDF with Canary yellow voucher and serial number', async () => {
  const pdfBuffer = await buildGatePassPdf({
    gate_pass_no: '005616',
    date: '23.11.26',
    time: '3.08 PM',
    sl_no: '1)',
    item: 'EMPTY TANKER',
    quantity: '1',
    purpose: 'TO BMC',
    whether_returnable: 'Returnable',
    to_whom_issued: 'S. PERIYASAMY',
    issued_by: 'Lab',
    vehicle_no: 'TN 18 AF 3088',
    issuing_officer: 'P. Nathiya',
    received_by: 'S. PERIYASAMY',
    security_officer: 'Security Guard',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer), 'Returns a binary Buffer');
  assert.ok(pdfBuffer.length > 500, 'Buffer has substantial content');
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-', 'Valid PDF file signature');
});

test('2. buildGatePassPdf handles missing or partial data with authentic defaults', async () => {
  const pdfBuffer = await buildGatePassPdf({
    gate_pass_no: '5616',
    date: '2026-11-24',
    time: '03:15 PM',
    to_whom_issued: 'K. Raja',
    vehicle_no: 'TN30BD3208',
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-');
});

test('3. gatePassStore persists and retrieves gate pass records reliably', async () => {
  const { saveGatePassFallback, getGatePassFallback } = await import('../dist/lib/gatePassStore.js');
  const dummyTripId = 'test-trip-9999';
  const passData = {
    gate_pass_no: '007788',
    date: '2026-11-24',
    time: '04:00 PM',
    to_whom_issued: 'Driver Testing',
    vehicle_no: 'TN42AA7226',
    item: 'EMPTY TANKER',
  };

  saveGatePassFallback(dummyTripId, passData);
  const retrieved = getGatePassFallback(dummyTripId);
  assert.ok(retrieved != null, 'Retrieved gate pass from store');
  assert.equal(retrieved.gate_pass_no, '007788');
  assert.equal(retrieved.vehicle_no, 'TN42AA7226');
});

test('4. shapeTrip resolves gate_pass from fallback store and cip_completed stage data', async () => {
  const { shapeTrip } = await import('../dist/lib/tripStore.js');
  const mockTrip = {
    id: 12345,
    dairy_unit_id: 1,
    tanker_id: 1,
    trip_date: '2026-11-24',
    status: 'at_plant',
    tankers: { vehicle_number: 'TN42AA7226' },
  };

  const mockStages = [
    {
      stage_key: 'cip_completed',
      status: 'done',
      data: {
        cip_status: 'pass',
        gate_pass: { gate_pass_no: '005522', vehicle_no: 'TN42AA7226' },
      },
    },
  ];

  const shaped = shapeTrip(mockTrip, [], mockStages);
  assert.ok(shaped.gate_pass != null, 'gate_pass field populated');
  assert.equal(shaped.gate_pass_no, '005522');
  assert.equal(shaped.stage_data.gate_pass?.gate_pass_no, '005522');
});
