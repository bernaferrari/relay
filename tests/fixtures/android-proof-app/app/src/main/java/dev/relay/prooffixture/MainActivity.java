package dev.relay.prooffixture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;

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

    Button language = findViewById(R.id.language_button);
    language.setOnClickListener(view -> {
      Log.i(LOG_TAG, "transition=settings-language");
      startActivity(new Intent(this, LanguageActivity.class));
    });

    getWindow().setStatusBarColor(getColor(R.color.relay_background));
    getWindow().setNavigationBarColor(getColor(R.color.relay_background));
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    Log.i(LOG_TAG, "screen=settings fixture=ready version=1");
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }
}
