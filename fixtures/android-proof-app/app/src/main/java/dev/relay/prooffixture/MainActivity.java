package dev.relay.prooffixture;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.TextView;

public final class MainActivity extends Activity {
  private static final String LOG_TAG = "RelayProofFixture";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    View root = findViewById(R.id.proof_root);
    int horizontal = dp(24);
    int top = dp(48);
    int bottom = dp(32);
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      int status = insets.getInsets(WindowInsets.Type.statusBars()).top;
      int navigation = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
      view.setPadding(horizontal, top + status, horizontal, bottom + navigation);
      return insets;
    });

    TextView status = findViewById(R.id.proof_status);
    Button prove = findViewById(R.id.prove_button);
    Button reset = findViewById(R.id.reset_button);

    prove.setOnClickListener(view -> {
      status.setText(R.string.passed);
      status.setTextColor(getColor(R.color.relay_success));
      status.setContentDescription("Checkpoint passed");
      Log.i(LOG_TAG, "checkpoint=passed");
    });
    reset.setOnClickListener(view -> {
      status.setText(R.string.ready);
      status.setTextColor(getColor(R.color.relay_text));
      status.setContentDescription("Ready for Relay");
      Log.i(LOG_TAG, "checkpoint=reset");
    });

    getWindow().setStatusBarColor(getColor(R.color.relay_background));
    getWindow().setNavigationBarColor(getColor(R.color.relay_background));
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    Log.i(LOG_TAG, "fixture=ready version=1");
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
