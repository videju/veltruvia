/**
 * VELTRUVIA Blockchain — Shared, tamper-evident audit chain.
 *
 * All four apps (Server, Doctor, Patient, Lab) append to ONE chain file
 * stored in the shared install root's data/ directory. The file on disk
 * is authoritative: before every append, this module re-reads it and
 * adopts blocks written by other apps, so each app extends the common tip.
 *
 * Integrity: each block's hash covers index/timestamp/data/previousHash,
 * and previousHash links to the block before it — tampering with any
 * historical block breaks every subsequent hash.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSharedRoot } from './shared-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let CHAIN_FILE = null;
function chainFile() {
  if (!CHAIN_FILE) {
    try {
      const chainDir = join(getSharedRoot(), 'data');
      try { mkdirSync(chainDir, { recursive: true }); } catch {}
      CHAIN_FILE = join(chainDir, 'chain.json');
    } catch {
      // Fallback: shared root next to the electron/ folder structure
      let dir = __dirname;
      for (let i = 0; i < 6; i++) {
        dir = dirname(dir);
        try {
          const appDirs = readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && e.name.startsWith('VELTRUVIA'));
          if (appDirs.length >= 2) {
            const chainDir = join(dir, 'data');
            try { mkdirSync(chainDir, { recursive: true }); } catch {}
            CHAIN_FILE = join(chainDir, 'chain.json');
            break;
          }
        } catch {}
      }
      if (!CHAIN_FILE) {
        const fallbackDir = join(process.cwd(), 'data');
        try { mkdirSync(fallbackDir, { recursive: true }); } catch {}
        CHAIN_FILE = join(fallbackDir, 'chain.json');
      }
    }
  }
  return CHAIN_FILE;
}

class Blockchain {
  constructor() {
    this.chain = [];
    this.load();
  }

  /**
   * Load the shared chain from disk. The file is authoritative: whatever
   * is on disk (including blocks written by other apps) is the chain.
   */
  load() {
    try {
      const file = chainFile();
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(data.chain) && data.chain.length > 0) {
          this.chain = data.chain;
          return;
        }
      }
    } catch (err) {
      console.error('[blockchain] Failed to load shared chain:', err.message);
    }
    if (this.chain.length === 0) {
      this.chain = [this.createGenesisBlock()];
      this.save();
    }
  }

  /**
   * Persist the full chain (tmp file + rename so readers never see a half file).
   */
  save() {
    try {
      const file = chainFile();
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ chain: this.chain }, null, 2));
      renameSync(tmp, file);
    } catch (err) {
      console.error('[blockchain] Failed to save chain:', err.message);
    }
  }

  /**
   * Re-read the shared file and adopt blocks other apps appended.
   * Only extends our history when disk continues our exact prefix.
   */
  syncFromDisk() {
    try {
      const file = chainFile();
      if (!existsSync(file)) return;
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const disk = Array.isArray(data.chain) ? data.chain : [];
      if (disk.length > this.chain.length) {
        const samePrefix = disk.length >= this.chain.length &&
          JSON.stringify(disk.slice(0, this.chain.length)) === JSON.stringify(this.chain);
        if (samePrefix) this.chain = disk;
      }
    } catch { /* unreadable disk state — keep in-memory chain */ }
  }

  createGenesisBlock() {
    const genesis = {
      index: 0,
      timestamp: new Date().toISOString(),
      data: { type: 'genesis', message: 'VELTRUVIA Blockchain Initialized' },
      previousHash: '0'.repeat(64),
      hash: '',
      app: 'system',
    };
    // Self-hash the genesis so fileVerify() sees a consistent chain.
    // (An empty hash here forced addBlock's `hash || recompute` fallback
    // to chain onto a hash the stored genesis never carried.)
    genesis.hash = this.calculateHash(genesis);
    return genesis;
  }

  calculateHash(block) {
    const { index, timestamp, data, previousHash } = block;
    const payload = `${index}${timestamp}${JSON.stringify(data)}${previousHash}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Add a new block to the shared chain.
   * @param {object} data - Block data (record, action, etc.)
   * @param {string} appName - Which app created this block ('doctor', 'patient', 'lab', 'server')
   * @returns {object} The new block
   */
  addBlock(data, appName) {
    this.syncFromDisk();
    const previousBlock = this.chain[this.chain.length - 1];
    const newBlock = {
      index: previousBlock.index + 1,
      timestamp: new Date().toISOString(),
      data,
      previousHash: previousBlock.hash || this.calculateHash(previousBlock),
      hash: '',
      app: appName,
    };
    newBlock.hash = this.calculateHash(newBlock);
    this.chain.push(newBlock);
    this.save();
    return newBlock;
  }

  recordPatient(mrn, recordData, appName = 'doctor') {
    return this.addBlock({ type: 'patient_record', mrn, record: recordData, action: 'create' }, appName);
  }

  recordPrescription(mrn, prescription, doctorName, appName = 'doctor') {
    return this.addBlock({ type: 'prescription', mrn, prescription, doctorName, action: 'create' }, appName);
  }

  recordLabResult(mrn, result, labName, appName = 'lab') {
    return this.addBlock({ type: 'lab_result', mrn, result, labName, action: 'create' }, appName);
  }

  recordAudit(action, details, appName = 'system') {
    return this.addBlock({ type: 'audit', action, details }, appName);
  }

  getPatientRecords(mrn) {
    return this.chain.filter(b => b.data && b.data.mrn === mrn && b.data.type !== 'audit');
  }

  getRecordsByType(type) {
    return this.chain.filter(b => b.data && b.data.type === type);
  }

  getAuditLog() {
    return this.chain.filter(b => b.data && b.data.type === 'audit');
  }

  getRecentBlocks(n = 10) {
    return this.chain.slice(-n);
  }

  verify() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];
      if (current.hash !== this.calculateHash(current)) {
        return { valid: false, error: `Block ${i} hash mismatch` };
      }
      if (current.previousHash !== previous.hash) {
        return { valid: false, error: `Block ${i} previous hash mismatch` };
      }
    }
    return { valid: true, chainLength: this.chain.length };
  }

  getStats() {
    const types = {};
    const apps = {};
    for (const block of this.chain) {
      if (block.data) {
        types[block.data.type] = (types[block.data.type] || 0) + 1;
        apps[block.app] = (apps[block.app] || 0) + 1;
      }
    }
    return {
      totalBlocks: this.chain.length,
      recordsByType: types,
      recordsByApp: apps,
      chainValid: this.verify().valid,
      chainFile: chainFile(),
    };
  }
}

// Singleton
const blockchain = new Blockchain();

export default blockchain;
export { Blockchain };
