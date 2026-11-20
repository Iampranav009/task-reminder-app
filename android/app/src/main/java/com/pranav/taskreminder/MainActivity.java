package com.pranav.taskreminder;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Microphone permission, the two gates Android needs before the WebView
 * can hear Pranav:
 *
 * 1. App gate — RECORD_AUDIO (+ MODIFY_AUDIO_SETTINGS) must be declared
 *    in AndroidManifest.xml and granted at runtime. Without the manifest
 *    lines Android never lists Microphone in Settings > Apps >
 *    Task Reminder > Permissions at all (Pranav's screenshot showed
 *    only Notifications, "No permissions denied").
 * 2. WebView gate — the page's AUDIO_CAPTURE request must be granted in
 *    WebChromeClient.onPermissionRequest(). A WebView with no override
 *    silently denies every media request, and SpeechRecognition then
 *    fails instantly with not-allowed and closes after ~1 second.
 *
 * Capacitor 8 already ships a BridgeWebChromeClient that does gate 2
 * (it asks Android for RECORD_AUDIO + MODIFY_AUDIO_SETTINGS and grants
 * only if all come back granted). This class SUBCLASSES it instead of
 * replacing it with a plain WebChromeClient, so Capacitor's JS dialogs,
 * file chooser, geolocation and console handling keep working.
 * It only special-cases audio capture: if RECORD_AUDIO is already
 * granted it grants the request straight away; if not, it holds the
 * request, asks Android, and grants/denies when the user answers.
 */
public class MainActivity extends BridgeActivity {

    private static final int REQUEST_MIC = 1001;
    private PermissionRequest pendingMicRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            webView.setWebChromeClient(new MicWebChromeClient(bridge));
        }
    }

    private class MicWebChromeClient extends BridgeWebChromeClient {

        MicWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            boolean wantsAudio = Arrays.asList(request.getResources())
                    .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
            if (!wantsAudio) {
                // Camera / anything else: Capacitor's own handling.
                super.onPermissionRequest(request);
                return;
            }
            // The WebView only ever loads our own local app
            // (https://localhost), so deny only a clearly foreign origin.
            // A null origin is trusted: it can only come from our WebView.
            Uri origin = request.getOrigin();
            String host = origin != null ? origin.getHost() : null;
            if (host != null && !"localhost".equals(host)) {
                request.deny();
                return;
            }
            if (ContextCompat.checkSelfPermission(
                    MainActivity.this, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                List<String> granted = new ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        granted.add(resource);
                    }
                }
                if (!granted.isEmpty()) {
                    request.grant(granted.toArray(new String[0]));
                } else {
                    request.deny();
                }
                return;
            }
            // Not granted yet: hold the WebView request, ask Android for
            // the runtime permission, then grant/deny in
            // onRequestPermissionsResult below.
            pendingMicRequest = request;
            ActivityCompat.requestPermissions(
                    MainActivity.this,
                    new String[]{
                            Manifest.permission.RECORD_AUDIO,
                            Manifest.permission.MODIFY_AUDIO_SETTINGS
                    },
                    REQUEST_MIC);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMicRequest == request) {
                pendingMicRequest = null;
            }
            super.onPermissionRequestCanceled(request);
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_MIC && pendingMicRequest != null) {
            boolean granted = false;
            for (int i = 0; i < permissions.length; i++) {
                if (Manifest.permission.RECORD_AUDIO.equals(permissions[i])
                        && grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                }
            }
            PermissionRequest request = pendingMicRequest;
            pendingMicRequest = null;
            if (granted) {
                request.grant(request.getResources());
            } else {
                request.deny();
            }
        }
    }
}
