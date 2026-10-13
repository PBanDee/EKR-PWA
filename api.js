'use strict';

window.EkrApi = Object.freeze({
  async uploadInstallation(installation, { simulateFailure = false } = {}) {
    if (!installation || typeof installation.id !== 'string' || installation.id.length === 0) {
      throw new Error('A mock API ervenytelen kivitelezes-azonositot kapott.');
    }
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
      throw new Error('A mock atveteli azonosito letrehozasa biztonsagos UUID-generalast igenyel.');
    }

    await new Promise((resolve) => window.setTimeout(resolve, 350));
    if (simulateFailure) {
      throw new Error('Szimulalt mock API-hiba. A helyi adatok megmaradtak.');
    }

    return {
      receiptId: `MOCK-${window.crypto.randomUUID()}`,
      receivedAt: new Date().toISOString()
    };
  }
});
