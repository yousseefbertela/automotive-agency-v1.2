'use strict';

/**
 * Integration-style tests for the /webhooks/waba route.
 * Mocks all external services (Firestore, WhatsApp, Odoo, Telegram).
 */

// Set up env before loading modules
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_ACCESS_TOKEN = 'fake-token';
process.env.TELEGRAM_BOT_TOKEN = 'fake-tg-token';
process.env.FIRESTORE_PROJECT_ID = 'test-project';

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  credential: { applicationDefault: jest.fn() },
  firestore: jest.fn(() => ({})),
}));

// Mock Firestore service
jest.mock('../src/services/firestore.service', () => ({
  getMessageDocument: jest.fn(),
  getQuote: jest.fn(),
  updateQuoteStatus: jest.fn(),
  closeQuote: jest.fn(),
  getBasketItems: jest.fn(),
  getSession: jest.fn(),
  getTenant: jest.fn(),
}));

// Mock WhatsApp service
jest.mock('../src/services/whatsapp.service', () => ({
  sendCancellationTemplate: jest.fn().mockResolvedValue({}),
  sendConfirmationTemplate: jest.fn().mockResolvedValue({}),
  sendTemplate: jest.fn().mockResolvedValue({}),
}));

// Mock Odoo service
jest.mock('../src/services/odoo.service', () => ({
  createOrderLine: jest.fn().mockResolvedValue({ id: 999 }),
  authenticate: jest.fn(),
  execute: jest.fn(),
}));

// Mock Telegram service
jest.mock('../src/services/telegram.service', () => ({
  sendMessage: jest.fn().mockResolvedValue({}),
}));

const http = require('http');
const app = require('../src/app');
const firestoreService = require('../src/services/firestore.service');
const whatsappService = require('../src/services/whatsapp.service');
const odooService = require('../src/services/odoo.service');
const telegramService = require('../src/services/telegram.service');

function makePayload(buttonPayload, contextId = 'wamid.abc123', waId = '201001234567') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '12345',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: waId, profile: { name: 'Customer' } }],
              messages: [
                {
                  from: waId,
                  id: 'wamid.incoming123',
                  timestamp: '1700000000',
                  type: 'button',
                  button: { payload: buttonPayload, text: buttonPayload },
                  context: { from: '804877562714688', id: contextId },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

// Helper to make POST request
function postWebhook(server, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const addr = server.address();
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path: '/webhooks/waba', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getVerify(server, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const addr = server.address();
    http.get(
      `http://127.0.0.1:${addr.port}/webhooks/waba?${qs}`,
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    ).on('error', reject);
  });
}

let server;

beforeAll((done) => {
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path mocks
  firestoreService.getMessageDocument.mockResolvedValue({ _id: 'wamid.abc123', quoteId: 'q-001' });
  firestoreService.updateQuoteStatus.mockResolvedValue();
  firestoreService.getBasketItems.mockResolvedValue([
    { _id: 'b1', part_number: '12345', chosen_product_id: 42, products: [{ id: 42, name: 'Brake pad', standard_price: 100 }], total_cost: 100 },
  ]);
  firestoreService.getQuote.mockResolvedValue({
    _id: 'q-001', customer_name: 'Ali', vehicle_details: { series: 'E90', model: '320i' },
    chat_id: '777', quotation_id: 555, status: 'pending',
  });
  firestoreService.closeQuote.mockResolvedValue();
  firestoreService.getSession.mockResolvedValue({ _id: '777', tenant_id: 'tenant-1' });
  firestoreService.getTenant.mockResolvedValue({ _id: 'tenant-1', name: 'PartPilot' });
});

describe('GET /webhooks/waba — verification', () => {
  test('returns challenge on valid verify token', async () => {
    const res = await getVerify(server, {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-verify-token',
      'hub.challenge': 'challenge-123',
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('challenge-123');
  });

  test('returns 403 on invalid verify token', async () => {
    const res = await getVerify(server, {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'anything',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/waba — cancellation', () => {
  test('processes cancellation button correctly', async () => {
    const payload = makePayload('تعديل / إلغاء');
    const res = await postWebhook(server, payload);
    expect(res.status).toBe(200);

    // Give async processing time to complete
    await new Promise((r) => setTimeout(r, 200));

    // Should update status to "cancelled"
    expect(firestoreService.updateQuoteStatus).toHaveBeenCalledWith('q-001', 'cancelled', expect.any(String));
    // Should close quote
    expect(firestoreService.closeQuote).toHaveBeenCalledWith('q-001', expect.any(String));
    // Should send WhatsApp cancellation
    expect(whatsappService.sendCancellationTemplate).toHaveBeenCalled();
    // Should notify Telegram
    expect(telegramService.sendMessage).toHaveBeenCalledWith('777', 'order has been cancelled by car owner', expect.any(String));
    // Should NOT create Odoo order lines
    expect(odooService.createOrderLine).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/waba — confirmation', () => {
  test('processes confirmation button correctly', async () => {
    const payload = makePayload('تأكيد العمل');
    const res = await postWebhook(server, payload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));

    // Should update status to "confirmed"
    expect(firestoreService.updateQuoteStatus).toHaveBeenCalledWith('q-001', 'confirmed', expect.any(String));
    // Should close quote
    expect(firestoreService.closeQuote).toHaveBeenCalledWith('q-001', expect.any(String));
    // Should create Odoo order line(s)
    expect(odooService.createOrderLine).toHaveBeenCalledTimes(1);
    expect(odooService.createOrderLine).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 555, productId: 42, name: 'Brake pad' }),
      expect.any(String)
    );
    // Should send WhatsApp confirmation
    expect(whatsappService.sendConfirmationTemplate).toHaveBeenCalled();
    // Should notify Telegram
    expect(telegramService.sendMessage).toHaveBeenCalledWith('777', 'order has been confirmed by car owner', expect.any(String));
  });
});

describe('POST /webhooks/waba — edge cases', () => {
  test('ignores status updates (no messages)', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'xxx' }] }, field: 'messages' }] }] };
    const res = await postWebhook(server, payload);
    expect(res.status).toBe(200);
    expect(firestoreService.getMessageDocument).not.toHaveBeenCalled();
  });

  test('ignores unknown button payload', async () => {
    const payload = makePayload('some unknown text');
    const res = await postWebhook(server, payload);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));

    expect(whatsappService.sendCancellationTemplate).not.toHaveBeenCalled();
    expect(whatsappService.sendConfirmationTemplate).not.toHaveBeenCalled();
  });
});
