
    let apiBase = '';

    async function loadStatus() {
      try {
        const res = await fetch(`${apiBase}/api/blockchain/status`);
        const data = await res.json();
        
        const badge = document.getElementById('status-badge');
        const stats = data.blockchain;
        
        if (stats.connected) {
          badge.className = 'status-badge connected';
          badge.innerHTML = '<div class="pulse"></div> Connected';
          document.getElementById('entry-count').textContent = stats.entryCount;
          document.getElementById('network').textContent = stats.network;
          document.getElementById('chain-id').textContent = stats.chainId;
        } else {
          badge.className = 'status-badge disconnected';
          badge.innerHTML = 'Disconnected';
        }
      } catch (err) {
        console.error('Failed to load status:', err);
      }
    }

    async function verifyRecord() {
      const hash = document.getElementById('record-hash').value.trim();
      if (!hash) return;

      const btn = document.getElementById('verify-btn');
      const resultBox = document.getElementById('result-box');
      
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      resultBox.className = 'result-box show';
      resultBox.textContent = 'Checking blockchain...';

      try {
        const res = await fetch(`${apiBase}/api/blockchain/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record: hash })
        });
        const data = await res.json();
        
        if (data.verification.verified) {
          resultBox.className = 'result-box show success';
          resultBox.textContent = `✅ RECORD VERIFIED\n\n` +
            `Hash: ${data.verification.recordHash}\n` +
            `Entries: ${data.verification.entryCount}\n` +
            `Action: ${data.verification.onChain.action}\n` +
            `Timestamp: ${data.verification.onChain.timestamp}`;
        } else {
          resultBox.className = 'result-box show error';
          resultBox.textContent = `❌ NOT FOUND\n\n${data.verification.error || 'Record not in blockchain'}`;
        }
      } catch (err) {
        resultBox.className = 'result-box show error';
        resultBox.textContent = `Error: ${err.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Verify';
      }
    }

    // Auto-refresh status
    loadStatus();
    setInterval(loadStatus, 10000);
  