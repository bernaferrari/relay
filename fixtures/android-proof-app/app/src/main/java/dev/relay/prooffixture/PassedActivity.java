package dev.relay.prooffixture;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;

public final class PassedActivity extends Activity {
  private static final String LOG_TAG = "RelayProofFixture";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_passed);

    View root = findViewById(R.id.passed_root);
    int horizontal = dp(24);
    int top = dp(48);
    int bottom = dp(32);
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      int status = insets.getInsets(WindowInsets.Type.statusBars()).top;
      int navigation = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
      view.setPadding(horizontal, top + status, horizontal, bottom + navigation);
      return insets;
    });

    Button reset = findViewById(R.id.reset_button);
    reset.setOnClickListener(view -> {
      Log.i(LOG_TAG, "checkpoint=reset");
      finish();
    });

    getWindow().setStatusBarColor(getColor(R.color.relay_background));
    getWindow().setNavigationBarColor(getColor(R.color.relay_background));
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    Log.i(LOG_TAG, "checkpoint=passed");
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
