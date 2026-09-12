// ═══════════════════════════════════════════════════════════════════════
// MLLP / TCP LAB INSTRUMENT INTERFACE
// ═══════════════════════════════════════════════════════════════════════
// Listens for HL7v2 messages over MLLP (Minimum Lower Layer Protocol)
// on a configurable TCP port.  Used to receive lab results directly
// from analyzers (Siemens, Abbott, Roche, etc.) over a local network.

import net from 'node:net';
import { parseHL7Message, generateAck } from './parser.js';
import { db, writeAudit } from '../db/index.js';

let mllpServer = null;
const connections = new Set();

// MLLP framing constants
const MLLP_START = 0x0B; // VT  — Start of Block
const MLLP_END = 0x1C;   // FS  — End of Block
const MLLP_CR = 0x0D;    // CR  — Carriage Return

/**
 * Start the MLLP/TCP server on the given port.
 * @param {number} port - TCP port to listen on (default: 2575 — standard MLLP)
 * @returns {net.Server}
 */
export function startMllpServer(port = parseInt(process.env.MLLP_PORT || '2575', 10)) {
  if (mllpServer) {
    console.log('[mllp] Server already running');
    return mllpServer;
  }

  mllpServer = net.createServer((socket) => {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    connections.add(addr);
    console.log(`[mllp] Instrument connected: ${addr}`);

    let buffer = Buffer.alloc(0);
    let expectingData = false;

    socket.on('data', async (chunk) => {
      // MLLP: data is wrapped in <VT>...<FS><CR> framing
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === MLLP_START) {
          buffer = Buffer.alloc(0);
          expectingData = true;
        } else if (expectingData && chunk[i] === MLLP_END) {
          // End of message — process it
          const message = buffer.toString('ascii');
          try {
            const parsed = parseHL7Message(message);
            const ack = await handleInstrumentMessage(parsed, addr);
            // Send ACK back to instrument
            const ackMessage = generateAck(parsed, ack.ackCode || 'AA');
            socket.write(Buffer.from([MLLP_START, ...Buffer.from(ackMessage), MLLP_END, MLLP_CR]));
          } catch (err) {
            console.error(`[mllp] Error processing message: ${err.message}`);
            // Send negative ACK
            const ack = generateAck({ header: {} }, 'AE', err.message);
            socket.write(Buffer.from([MLLP_START, ...Buffer.from(ack), MLLP_END, MLLP_CR]));
          }
          buffer = Buffer.alloc(0);
          expectingData = false;
        } else if (expectingData) {
          buffer = Buffer.concat([buffer, Buffer.from([chunk[i]])]);
        }
      }
    });

    socket.on('close', () => {
      connections.delete(addr);
      console.log(`[mllp] Instrument disconnected: ${addr}`);
    });

    socket.on('error', (err) => {
      connections.delete(addr);
      console.error(`[mllp] Socket error from ${addr}:`, err.message);
    });
  });

  mllpServer.listen(port, () => {
    console.log(`[mllp] MLLP/TCP server listening on port ${port}`);
    console.log(`[mllp] Instruments can connect via TCP to ${port}`);
  });

  mllpServer.on('error', (err) => {
    console.error(`[mllp] Server error:`, err.message);
  });

  return mllpServer;
}

/**
 * Process a message received from a lab instrument.
 */
async function handleInstrumentMessage(parsed, sourceAddr) {
  const eventType = parsed.eventType || 'unknown';

  switch (eventType) {
    case 'ORU^R01': {
      // Lab result received
      return await handleLabResult(parsed, sourceAddr);
    }
    case 'ORM^O01': {
      // Order received (instrument acknowledges order)
      return await handleOrder(parsed, sourceAddr);
    }
    case 'ADT^A01':
    case 'ADT^A08': {
      // Patient registration/update from instrument
      return await handlePatientUpdate(parsed, sourceAddr);
    }
    case 'ACK': {
      // Acknowledgment
      console.log(`[mllp] ACK received from ${sourceAddr}`);
      return { ackCode: 'AA' };
    }
    default:
      console.log(`[mllp] Unhandled event type: ${eventType}`);
      return { ackCode: 'AR', message: `Unknown event type: ${eventType}` };
  }
}

/**
 * Handle lab results from an instrument (ORU^R01).
 */
async function handleLabResult(parsed, sourceAddr) {
  const patientId = parsed.patientId || parsed.patientMrn;
  const results = parsed.observations || [];

  for (const obs of results) {
    const id = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const value = obs.value || obs.result;
    const units = obs.units || '';
    const normalRange = obs.referenceRange || '';

    await db.prepare(`
      INSERT OR REPLACE INTO biomarker_results (id, patient_mrn, biomarker, value, units, reference_range, test_date, ordering_provider, status, lab_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, 'final', ?, datetime('now'))
    `).run(
      id,
      patientId,
      obs.testName || obs.identifier || 'unknown',
      value,
      units,
      normalRange,
      parsed.orderingProvider || 'instrument',
      `MLLP:${sourceAddr}`
    );
  }

  await writeAudit({
    actorId: 'mllp-instrument', actorRole: 'system',
    action: 'lab.result_received', targetId: patientId,
    detail: { resultCount: results.length, source: sourceAddr, eventType: parsed.eventType },
    ip: sourceAddr,
  });

  console.log(`[mllp] Lab results stored: ${results.length} results for patient ${patientId}`);
  return { ackCode: 'AA', message: `${results.length} results stored` };
}

/**
 * Handle order acknowledgment from instrument (ORM^O01).
 */
async function handleOrder(parsed, sourceAddr) {
  console.log(`[mllp] Order ${parsed.orderId || 'unknown'} acknowledged by instrument at ${sourceAddr}`);
  return { ackCode: 'AA' };
}

/**
 * Handle patient registration/update from instrument (ADT^A01/A08).
 */
async function handlePatientUpdate(parsed, sourceAddr) {
  const patientId = parsed.patientId || parsed.patientMrn;
  if (patientId) {
    // Store in kv_store if not exists
    const existing = await db.prepare(`SELECT k FROM kv_store WHERE k = ?`).get(`patient:${patientId}`);
    if (!existing && parsed.patientName) {
      await db.prepare(`
        INSERT OR REPLACE INTO kv_store (owner_id, k, v_enc, updated_at)
        VALUES ('system', ?, ?, datetime('now'))
      `).run(`patient:${patientId}`, JSON.stringify({
        mrn: patientId,
        name: parsed.patientName,
        dob: parsed.dob,
        sex: parsed.sex,
        source: 'mllp-instrument',
        receivedAt: new Date().toISOString(),
      }));
    }
  }
  return { ackCode: 'AA' };
}

/**
 * Get MLLP server status.
 */
export function getMllpStatus() {
  return {
    running: !!mllpServer,
    connections: Array.from(connections),
    port: parseInt(process.env.MLLP_PORT || '2575', 10),
  };
}

/**
 * Stop the MLLP server.
 */
export function stopMllpServer() {
  if (mllpServer) {
    for (const conn of connections) {
      console.log(`[mllp] Closing connection: ${conn}`);
    }
    mllpServer.close();
    mllpServer = null;
    connections.clear();
    console.log('[mllp] Server stopped');
  }
}
