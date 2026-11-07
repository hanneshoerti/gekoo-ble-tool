// Stellt navigator.bluetooth in der Android-App bereit (WebView kann kein Web Bluetooth).
// Die eigentliche Bluetooth-Arbeit macht MainActivity.java über window.GekooNative.
// Im normalen Browser tut diese Datei nichts.
(function () {
  const N = window.GekooNative;
  if (!N) return;

  const pending = new Map();
  let seq = 0;
  const call = (method, arg = '') => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    N[method](id, arg);
  });
  window.__gekooResolve = (id, ok, value) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(value) : p.reject(new Error(value));
  };

  const valueListeners = new Set();
  const disconnectListeners = new Set();
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

  window.__gekooNotify = (hex) => {
    const value = new DataView(fromHex(hex).buffer);
    for (const fn of valueListeners) fn({ target: { value } });
  };
  window.__gekooDisconnected = () => {
    device.gatt.connected = false;
    for (const fn of disconnectListeners) fn({});
  };

  const characteristic = {
    startNotifications: () => call('startNotifications').then(() => characteristic),
    stopNotifications: async () => characteristic,
    addEventListener(type, fn) { if (type === 'characteristicvaluechanged') valueListeners.add(fn); },
    removeEventListener(type, fn) { valueListeners.delete(fn); },
    writeValueWithoutResponse(data) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
      return call('write', toHex(bytes));
    },
  };

  const device = {
    name: 'GEKOO-BLE',
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') disconnectListeners.add(fn); },
    gatt: {
      connected: false,
      async connect() { await call('connect'); this.connected = true; return this; },
      disconnect() { this.connected = false; N.disconnect(); },
      async getPrimaryService() { return { getCharacteristic: async () => characteristic }; },
    },
  };

  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: {
      requestDevice: () => call('requestDevice').then((name) => { device.name = name || 'GEKOO-BLE'; return device; }),
      getAvailability: async () => true,
    },
  });

  window.gekooSaveFile = (name, text) => N.saveFile(name, text);
})();
