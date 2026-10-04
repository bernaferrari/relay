package dev.relay.appinventory;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** A one-shot PackageManager read. No Activity or UiAutomation is created. */
public final class InstalledAppsInstrumentation extends Instrumentation {
  private static final String PROTOCOL = "relay-android-app-inventory-v1";
  private static final int MAX_APPLICATIONS = 2048;
  private static final int MAX_LABEL_LENGTH = 256;
  private static final int MAX_PAYLOAD_BYTES = 512 * 1024;
  private static final int CHUNK_BYTES = 2048;

  @Override
  public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    start();
  }

  @Override
  public void onStart() {
    super.onStart();
    Bundle result = metadata();
    try {
      PackageManager manager = getContext().getPackageManager();
      Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
      Map<String, ApplicationInfo> applications = new TreeMap<>();
      for (ResolveInfo resolved : manager.queryIntentActivities(launcher, 0)) {
        if (resolved.activityInfo == null || resolved.activityInfo.applicationInfo == null) continue;
        ApplicationInfo application = resolved.activityInfo.applicationInfo;
        applications.put(application.packageName, application);
      }

      JSONArray labels = new JSONArray();
      int payloadBytes = 2;
      for (Map.Entry<String, ApplicationInfo> entry : applications.entrySet()) {
        if (labels.length() >= MAX_APPLICATIONS) break;
        String label;
        try {
          CharSequence observed = manager.getApplicationLabel(entry.getValue());
          label = observed == null ? "" : observed.toString().trim();
        } catch (RuntimeException unavailable) {
          // One unreadable resource must not discard other observed labels.
          continue;
        }
        if (label.isEmpty() || label.equals(entry.getKey()) || label.length() > MAX_LABEL_LENGTH) continue;
        JSONObject app = new JSONObject();
        app.put("package", entry.getKey());
        app.put("name", label);
        int entryBytes = app.toString().getBytes(StandardCharsets.UTF_8).length + 1;
        if (payloadBytes + entryBytes > MAX_PAYLOAD_BYTES) break;
        labels.put(app);
        payloadBytes += entryBytes;
      }

      byte[] payload = labels.toString().getBytes(StandardCharsets.UTF_8);
      int chunkCount = (payload.length + CHUNK_BYTES - 1) / CHUNK_BYTES;
      for (int index = 0; index < chunkCount; index++) {
        int offset = index * CHUNK_BYTES;
        int length = Math.min(CHUNK_BYTES, payload.length - offset);
        Bundle chunk = metadata();
        chunk.putString("chunkIndex", Integer.toString(index));
        chunk.putString("chunkCount", Integer.toString(chunkCount));
        chunk.putString("payloadBase64", Base64.encodeToString(payload, offset, length, Base64.NO_WRAP));
        sendStatus(1, chunk);
      }
      result.putString("ok", "true");
      finish(0, result);
    } catch (Exception unavailable) {
      result.putString("ok", "false");
      finish(1, result);
    }
  }

  private static Bundle metadata() {
    Bundle bundle = new Bundle();
    bundle.putString("relayProtocol", PROTOCOL);
    bundle.putString("outputFormat", "application-labels-json");
    return bundle;
  }
}
