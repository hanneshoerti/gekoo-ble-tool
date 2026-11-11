package io.github.gekooble.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;

/**
 * Zeigt die Web-Oberfläche (assets/www) in einer WebView und stellt ihr über
 * window.GekooNative eine Bluetooth-LE-Verbindung bereit (siehe android-bridge.js).
 */
@SuppressLint({"MissingPermission", "SetJavaScriptEnabled"})
public class MainActivity extends Activity {

    private static final UUID SERVICE = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb");
    private static final UUID CHAR = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_PERMISSIONS = 1;
    private static final int REQ_FILE = 2;
    private static final int REQ_LOCATION = 3;
    private static final long SCAN_TIMEOUT_MS = 10000;
    private static final long CONNECT_TIMEOUT_MS = 15000;
    private static final long OP_TIMEOUT_MS = 2000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;

    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private BluetoothDevice selected;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic characteristic;
    private boolean userDisconnect = false;
    private boolean servicesRequested = false;

    private int pendingRequestId = -1;
    private int pendingConnectId = -1;

    /** GATT-Operationen strikt nacheinander ausführen (Android erlaubt nur eine gleichzeitig). */
    private interface GattAction { boolean start(); }
    private static final class Op {
        final int id; final GattAction action; final boolean okOnTimeout;
        Op(int id, GattAction action, boolean okOnTimeout) { this.id = id; this.action = action; this.okOnTimeout = okOnTimeout; }
    }
    private final ArrayDeque<Op> ops = new ArrayDeque<>();
    private Op currentOp;
    private final Runnable opTimeout = () -> {
        if (currentOp != null) finishOp(currentOp.okOnTimeout, "Zeitüberschreitung");
    };

    // ------------------------------------------------------------------ Lebenszyklus

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(true);
        web.addJavascriptInterface(new Bridge(), "GekooNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!HOST.equals(url.getHost())) return null;
                String path = url.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mimeType(path), "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            null, new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (HOST.equals(request.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // GPS für die Seite: nur eigene Inhalte, Android-Berechtigung bei Bedarf abfragen
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!origin.contains(HOST)) { callback.invoke(origin, false, false); return; }
                if (hasLocationPermission()) { callback.invoke(origin, true, false); return; }
                geoOrigin = origin;
                geoCallback = callback;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        stopScan();
        if (gatt != null) { gatt.disconnect(); gatt.close(); gatt = null; }
        web.destroy();
        super.onDestroy();
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------------ Antworten an JavaScript

    private void resolve(int id, boolean ok, String value) {
        main.post(() -> web.evaluateJavascript("window.__gekooResolve && window.__gekooResolve("
                + id + "," + ok + "," + JSONObject.quote(value == null ? "" : value) + ")", null));
    }

    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    private static byte[] unhex(String h) {
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return out;
    }

    // ------------------------------------------------------------------ Berechtigungen

    private String[] neededPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT};
        }
        return new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }

    private boolean hasPermissions() {
        for (String p : neededPermissions()) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_LOCATION) {
            if (geoCallback != null) geoCallback.invoke(geoOrigin, hasLocationPermission(), false);
            geoCallback = null;
            geoOrigin = null;
            return;
        }
        if (requestCode != REQ_PERMISSIONS || pendingRequestId < 0) return;
        int id = pendingRequestId;
        pendingRequestId = -1;
        if (hasPermissions()) startScan(id);
        else resolve(id, false, "Bluetooth-Berechtigung wurde nicht erteilt (Einstellungen → Apps → Gekoo Controller → Berechtigungen).");
    }

    // ------------------------------------------------------------------ Suchen

    private void requestDevice(int id) {
        if (!hasPermissions()) {
            pendingRequestId = id;
            requestPermissions(neededPermissions(), REQ_PERMISSIONS);
            return;
        }
        startScan(id);
    }

    private void startScan(int id) {
        BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        adapter = bm == null ? null : bm.getAdapter();
        if (adapter == null) { resolve(id, false, "Dieses Gerät hat kein Bluetooth."); return; }
        if (!adapter.isEnabled()) { resolve(id, false, "Bluetooth ist ausgeschaltet."); return; }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { resolve(id, false, "Bluetooth-Suche nicht verfügbar."); return; }
        stopScan();

        final ParcelUuid serviceUuid = new ParcelUuid(SERVICE);
        final boolean[] done = {false};
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (done[0]) return;
                ScanRecord rec = result.getScanRecord();
                String name = rec != null ? rec.getDeviceName() : null;
                if (name == null) name = result.getDevice().getName();
                List<ParcelUuid> uuids = rec != null ? rec.getServiceUuids() : null;
                boolean match = (name != null && name.toUpperCase().startsWith("GEKOO"))
                        || (uuids != null && uuids.contains(serviceUuid));
                if (!match) return;
                done[0] = true;
                main.post(() -> {
                    stopScan();
                    selected = result.getDevice();
                    String n = result.getDevice().getName();
                    resolve(id, true, n != null ? n : "GEKOO-BLE");
                });
            }

            @Override
            public void onScanFailed(int errorCode) {
                if (done[0]) return;
                done[0] = true;
                main.post(() -> { stopScan(); resolve(id, false, "Bluetooth-Suche fehlgeschlagen (" + errorCode + ")."); });
            }
        };
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanner.startScan(null, settings, scanCallback);
        main.postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            stopScan();
            resolve(id, false, "Kein GEKOO-BLE gefunden. Ist der Roller an und die WeChat-App geschlossen?");
        }, SCAN_TIMEOUT_MS);
    }

    private void stopScan() {
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) { }
        }
        scanCallback = null;
    }

    // ------------------------------------------------------------------ Verbinden

    private void connect(int id) {
        if (selected == null) { resolve(id, false, "Kein Gerät ausgewählt."); return; }
        if (gatt != null) { gatt.close(); gatt = null; }
        characteristic = null;
        userDisconnect = false;
        servicesRequested = false;
        pendingConnectId = id;
        gatt = selected.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        main.postDelayed(() -> {
            if (pendingConnectId == id) {
                pendingConnectId = -1;
                if (gatt != null) { gatt.close(); gatt = null; }
                resolve(id, false, "Verbindung hat zu lange gedauert.");
            }
        }, CONNECT_TIMEOUT_MS);
    }

    private void disconnect() {
        userDisconnect = true;
        if (gatt != null) gatt.disconnect();
    }

    private void onDisconnected(BluetoothGatt g) {
        g.close();
        if (gatt == g) gatt = null;
        characteristic = null;
        main.removeCallbacks(opTimeout);
        if (currentOp != null) resolve(currentOp.id, false, "Verbindung getrennt");
        for (Op op : ops) resolve(op.id, false, "Verbindung getrennt");
        ops.clear();
        currentOp = null;
        if (pendingConnectId >= 0) {
            int id = pendingConnectId;
            pendingConnectId = -1;
            resolve(id, false, "Verbindung fehlgeschlagen.");
        } else if (!userDisconnect) {
            js("window.__gekooDisconnected && window.__gekooDisconnected()");
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            main.post(() -> {
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    // Größere Pakete erlauben (wie in der Original-App), danach Dienste suchen.
                    // Falls die MTU-Antwort ausbleibt, nach 1,5 s trotzdem weitermachen.
                    if (!g.requestMtu(247)) discover(g);
                    else main.postDelayed(() -> discover(g), 1500);
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                    onDisconnected(g);
                }
            });
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            main.post(() -> discover(g));
        }

        private void discover(BluetoothGatt g) {
            if (pendingConnectId < 0 || servicesRequested || g != gatt) return;
            servicesRequested = true;
            g.discoverServices();
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            main.post(() -> {
                if (pendingConnectId < 0) return;
                int id = pendingConnectId;
                pendingConnectId = -1;
                BluetoothGattService svc = g.getService(SERVICE);
                characteristic = svc != null ? svc.getCharacteristic(CHAR) : null;
                if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null) {
                    resolve(id, false, "Gekoo-Dienst (FFE0/FFE1) nicht gefunden.");
                    userDisconnect = true;
                    g.disconnect();
                    return;
                }
                resolve(id, true, "");
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            main.post(() -> finishOp(status == BluetoothGatt.GATT_SUCCESS, "Benachrichtigungen konnten nicht aktiviert werden"));
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            main.post(() -> finishOp(status == BluetoothGatt.GATT_SUCCESS, "Senden fehlgeschlagen"));
        }

        // Android 13+
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
            deliver(value);
        }

        // Android 10–12
        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return;
            deliver(c.getValue());
        }

        private void deliver(byte[] value) {
            if (value == null || value.length == 0) return;
            js("window.__gekooNotify && window.__gekooNotify('" + hex(value) + "')");
        }
    };

    // ------------------------------------------------------------------ GATT-Operationen

    private void enqueue(int id, GattAction action, boolean okOnTimeout) {
        if (gatt == null || characteristic == null) { resolve(id, false, "Nicht verbunden."); return; }
        ops.add(new Op(id, action, okOnTimeout));
        runNextOp();
    }

    private void runNextOp() {
        if (currentOp != null || ops.isEmpty()) return;
        currentOp = ops.poll();
        boolean started;
        try { started = currentOp.action.start(); } catch (Exception e) { started = false; }
        if (!started) { finishOp(false, "Bluetooth beschäftigt"); return; }
        main.postDelayed(opTimeout, OP_TIMEOUT_MS);
    }

    private void finishOp(boolean ok, String error) {
        if (currentOp == null) return;
        main.removeCallbacks(opTimeout);
        resolve(currentOp.id, ok, ok ? "" : error);
        currentOp = null;
        runNextOp();
    }

    @SuppressWarnings("deprecation")
    private boolean enableNotifications() {
        BluetoothGattCharacteristic c = characteristic;
        if (gatt == null || c == null || !gatt.setCharacteristicNotification(c, true)) return false;
        BluetoothGattDescriptor d = c.getDescriptor(CCCD);
        if (d == null) return false;
        byte[] value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return gatt.writeDescriptor(d, value) == BluetoothGatt.GATT_SUCCESS;
        }
        d.setValue(value);
        return gatt.writeDescriptor(d);
    }

    @SuppressWarnings("deprecation")
    private boolean writeBytes(byte[] value) {
        BluetoothGattCharacteristic c = characteristic;
        if (gatt == null || c == null) return false;
        int type = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return gatt.writeCharacteristic(c, value, type) == BluetoothGatt.GATT_SUCCESS;
        }
        c.setWriteType(type);
        c.setValue(value);
        return gatt.writeCharacteristic(c);
    }

    // ------------------------------------------------------------------ Datei speichern

    private String saveDownload(String name, String text) throws IOException {
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
        cv.put(MediaStore.Downloads.MIME_TYPE, safe.endsWith(".json") ? "application/json" : "text/plain");
        cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Gekoo");
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IOException("Datei konnte nicht angelegt werden");
        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
            if (os == null) throw new IOException("Datei konnte nicht geöffnet werden");
            os.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return "Download/Gekoo/" + safe;
    }

    // ------------------------------------------------------------------ Brücke für JavaScript

    private final class Bridge {
        @JavascriptInterface
        public void requestDevice(int id, String arg) { main.post(() -> MainActivity.this.requestDevice(id)); }

        @JavascriptInterface
        public void connect(int id, String arg) { main.post(() -> MainActivity.this.connect(id)); }

        @JavascriptInterface
        public void startNotifications(int id, String arg) {
            main.post(() -> enqueue(id, MainActivity.this::enableNotifications, false));
        }

        @JavascriptInterface
        public void write(int id, String hexValue) {
            final byte[] value = unhex(hexValue);
            main.post(() -> enqueue(id, () -> writeBytes(value), true));
        }

        @JavascriptInterface
        public void disconnect() { main.post(MainActivity.this::disconnect); }

        @JavascriptInterface
        public String saveFile(String name, String text) {
            try {
                return saveDownload(name, text);
            } catch (Exception e) {
                return "Fehler: " + e.getMessage();
            }
        }
    }
}
