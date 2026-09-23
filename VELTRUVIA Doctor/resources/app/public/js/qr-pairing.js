// ═══════════════════════════════════════════════════════════════════
// VELTRUVIA QR Pairing — scan the server's "Connect a phone" QR code
// to set the app's server address (replaces typing/pasting it).
//
// Decoder: BarcodeDetector (native on Android WebView 83+) with jsQR
// (vendored locally at js/vendor/jsQR.js — CSP forbids remote scripts)
// as the fallback for older WebViews.
//
// Public API:
//   QRPairing.scanInto(el)   → Promise<string|null>  decoded text
//   QRPairing.attachToButton(btn)                  one-tap wiring
//
// Validation: accepts only http(s) URLs; applies the same
// normalization as mobile-api.js (adds https:// when scheme missing).
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(true);
    return new Promise((resolve) => {
      var s = document.createElement('script');
      s.src = 'js/vendor/jsQR.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  function pickCamera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('no camera API'));
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(function (stream) { video.srcObject = stream; return stream; });
  }

  function closeStream(stream) {
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  }

  function overlay() {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:100001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
    wrap.innerHTML =
      '<div style="position:relative;width:min(86vw,380px);aspect-ratio:1;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.6)">' +
      '  <video playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
      '  <div style="position:absolute;inset:14%;border:2px solid rgba(255,255,255,.85);border-radius:12px"></div>' +
      '</div>' +
      '<p id="vqr-msg" style="color:#fff;margin:14px 0 0;text-align:center;font-size:14px;opacity:.9">Point the camera at the QR code on the server\'s download page</p>' +
      '<button id="vqr-cancel" style="margin-top:18px;padding:10px 26px;border-radius:999px;border:0;background:#fff;color:#111;font-size:15px;font-weight:600">Cancel</button>';
    document.body.appendChild(wrap);
    return wrap;
  }

  // Scan loop: BarcodeDetector when present, else jsQR on canvas frames.
  function scanLoop(video, canvas, msg, done) {
    var stopped = false;
    var detector = null;
    var jsQRFallback = false;

    function finish(text) {
      if (stopped) return;
      stopped = true;
      done(text);
    }

    if ('BarcodeDetector' in window) {
      try {
        detector = new window.BarcodeDetector();
        detector.detect(video).then(function (codes) {
          if (codes && codes.length && codes[0].rawValue) finish(codes[0].rawValue);
        }).catch(function () { detector = null; });
      } catch (e) { detector = null; }
    }
    if (!detector) {
      jsQRFallback = true;
      if (!window.jsQR) { msg.textContent = 'Scanner unavailable on this device — please type the address instead.'; }
    }

    function tick() {
      if (stopped) return;
      if (jsQRFallback && window.jsQR && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);
        try {
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) { finish(code.data); return; }
        } catch (e) {}
      }
      requestAnimationFrame(tick);
    }

    // BarcodeDetector polling loop (it does not stream)
    if (detector) {
      (function poll() {
        if (stopped) return;
        detector.detect(video).then(function (codes) {
          if (codes && codes.length && codes[0].rawValue) finish(codes[0].rawValue);
          else setTimeout(poll, 250);
        }).catch(function () { setTimeout(poll, 400); });
      })();
    } else {
      requestAnimationFrame(tick);
    }
    return function stop() { stopped = true; };
  }

  function scanInto() {
    return loadJsQR().then(function () {
      return new Promise(function (resolve) {
        var wrap = overlay();
        var video = wrap.querySelector('video');
        var msg = wrap.querySelector('#vqr-msg');
        var cancel = wrap.querySelector('#vqr-cancel');
        var canvas = document.createElement('canvas');
        var stream = null, stopScan = null;

        function cleanup(result) {
          if (stopScan) stopScan();
          closeStream(stream);
          wrap.remove();
          resolve(result);
        }
        cancel.addEventListener('click', function () { cleanup(null); });

        pickCamera(video).then(function (s) {
          stream = s;
          video.play().catch(function () {});
          stopScan = scanLoop(video, canvas, msg, function (text) { cleanup(text); });
        }).catch(function () {
          msg.textContent = 'Camera unavailable or permission denied — please type the address instead.';
          setTimeout(function () { cleanup(null); }, 2500);
        });
      });
    });
  }

  function normalize(text) {
    if (!text) return null;
    var t = String(text).trim();
    if (/^https?:\/\//i.test(t)) return t.replace(/\/+$/, '');
    if (/^[\w.-]+(:\d+)?(\/.*)?$/.test(t)) return 'https://' + t.replace(/\/+$/, '');
    return null;
  }

  window.QRPairing = {
    scanInto: scanInto,
    normalize: normalize,
  };
})();
