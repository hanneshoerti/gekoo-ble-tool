// Simulierter GEKOO-Controller für Demo-Modus (#demo) und automatische Tests.
// Ersetzt navigator.bluetooth durch ein Fake-Gerät, das wie der echte Controller antwortet.
import { CMD, buildWriteFrame, wordsFromBlock, checksum } from './gekoo.js';
import { DEMO_PARAMS, DEMO_LIVE } from './demo-data.js';

export function installMockBluetooth(win = window) {
  let params = DEMO_PARAMS.slice();
  let live = 0, unlocked = false, rx = [];
  const listeners = new Set();
  const notify = (bytes) => setTimeout(() => {
    const value = new DataView(Uint8Array.from(bytes).buffer);
    for (const l of listeners) l({ target: { value } });
  }, 15);
  const send20 = (bytes) => { for (let i = 0; i < bytes.length; i += 20) notify(bytes.slice(i, i + 20)); };
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const characteristic = {
    async startNotifications() { return this; },
    async stopNotifications() { return this; },
    addEventListener(_, fn) { listeners.add(fn); },
    removeEventListener(_, fn) { listeners.delete(fn); },
    async writeValueWithoutResponse(buf) {
      const b = [...new Uint8Array(buf.buffer ?? buf)];
      if (rx.length) {                         // laufender Schreib-Frame
        rx.push(...b);
        if (rx.length >= 131) {
          const words = wordsFromBlock(Uint8Array.from(rx.slice(0, 131)));
          rx = [];
          if (unlocked && checksum(words) === words[63]) { params = words; notify([0xaa, 0x12, 0x00, 0xaa]); }
          else notify([0xaa, 0x12, 0x00, 0x00]);
          unlocked = false;
        }
        return;
      }
      if (eq(b, [...CMD.POLL])) {
        const frame = Uint8Array.from(DEMO_LIVE[live++ % DEMO_LIVE.length]);
        send20([...frame, 0xaa, 0x13, 0x00, 0x01]);
      } else if (eq(b, [...CMD.READ_PARAMS])) {
        const f = buildWriteFrame(params); f[1] = 0x11; send20([...f]);
      } else if (eq(b, [...CMD.UNLOCK_WRITE])) { unlocked = true; notify([0xaa, 0x21, 0x00, 0x01]); }
      else if (eq(b, [...CMD.READ_ID])) notify([0xaa, 0x17, 0x00, params[60] & 0xff, params[60] >> 8]);
      else if (b[0] === 0xaa && b[1] === 0x12) rx = b;
    },
  };
  const discListeners = new Set();
  const device = {
    name: 'GEKOO-BLE (Demo)',
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') discListeners.add(fn); },
    gatt: {
      connected: false,
      async connect() { this.connected = true; return this; },
      disconnect() { this.connected = false; },
      async getPrimaryService() { return { getCharacteristic: async () => characteristic }; },
    },
  };
  Object.defineProperty(win.navigator, 'bluetooth', {
    configurable: true,
    value: { requestDevice: async () => device, getAvailability: async () => true },
  });
  // Zum Testen: Verbindungsabbruch simulieren (z. B. Zündung aus)
  const simulateDisconnect = () => { device.gatt.connected = false; for (const fn of discListeners) fn({}); };
  win.__gekooMockDisconnect = simulateDisconnect;
  return { get params() { return params; }, simulateDisconnect };
}
