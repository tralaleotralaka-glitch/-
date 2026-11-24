package ru.nit.messenger;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(40, 36, 62);
    private static final int PURPLE = Color.rgb(114, 88, 220);
    private static final int CANVAS = Color.rgb(244, 242, 237);
    private static final int MUTED = Color.rgb(133, 130, 142);
    private static final String PREFERENCES = "nit_messenger_settings";
    private static final String SERVER_URL_KEY = "server_url";

    private LinearLayout root;
    private FrameLayout content;
    private TextView serverButton;
    private WebView webView;
    private EditText serverInput;
    private TextView errorText;
    private String serverUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(INK);
        getWindow().setNavigationBarColor(INK);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(CANVAS);
        setContentView(root);
        buildToolbar();

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        createWebView();

        SharedPreferences preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        String savedUrl = preferences.getString(SERVER_URL_KEY, "");
        String initialUrl = savedUrl.isEmpty() ? BuildConfig.DEFAULT_WEB_APP_URL : savedUrl;
        if (isValidServerUrl(initialUrl)) {
            serverUrl = normalizeUrl(initialUrl);
            showWebView();
        } else {
            showSetupScreen("");
        }
    }

    private void buildToolbar() {
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(18), 0, dp(14), 0);
        toolbar.setBackgroundColor(Color.rgb(255, 254, 250));

        TextView mark = new TextView(this);
        mark.setText("н");
        mark.setTextColor(Color.WHITE);
        mark.setTextSize(20);
        mark.setTypeface(Typeface.SERIF, Typeface.BOLD_ITALIC);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(rounded(PURPLE, 0, 12));
        toolbar.addView(mark, new LinearLayout.LayoutParams(dp(34), dp(34)));

        TextView title = new TextView(this);
        title.setText("нить");
        title.setTextColor(INK);
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleParams.leftMargin = dp(10);
        toolbar.addView(title, titleParams);

        serverButton = new TextView(this);
        serverButton.setText("Адрес сервера");
        serverButton.setTextColor(PURPLE);
        serverButton.setTextSize(11);
        serverButton.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        serverButton.setGravity(Gravity.CENTER);
        serverButton.setPadding(dp(11), dp(8), dp(11), dp(8));
        serverButton.setBackground(rounded(Color.rgb(246, 243, 255), 0, 9));
        serverButton.setVisibility(View.GONE);
        serverButton.setOnClickListener(view -> showSetupScreen(""));
        toolbar.addView(serverButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)));

        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(64)));
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(251, 250, 248));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        CookieManager.getInstance().setAcceptCookie(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri destination = request.getUrl();
                if (isSameOrigin(destination, serverUrl)) return false;
                openOutsideApp(destination);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri destination = Uri.parse(url);
                if (isSameOrigin(destination, serverUrl)) return false;
                openOutsideApp(destination);
                return true;
            }
        });
    }

    private void showWebView() {
        content.removeAllViews();
        if (webView.getParent() instanceof ViewGroup) {
            ((ViewGroup) webView.getParent()).removeView(webView);
        }
        content.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        serverButton.setVisibility(View.VISIBLE);
        if (serverUrl.isEmpty()) return;
        webView.loadUrl(serverUrl);
    }

    private void showSetupScreen(String message) {
        content.removeAllViews();
        serverButton.setVisibility(serverUrl.isEmpty() ? View.GONE : View.VISIBLE);

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(CANVAS);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.setPadding(dp(22), dp(28), dp(22), dp(28));
        scrollView.addView(page, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(24), dp(22), dp(22));
        card.setBackground(rounded(Color.rgb(255, 254, 250), Color.rgb(238, 235, 240), 22));
        page.addView(card, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView icon = new TextView(this);
        icon.setText("✳");
        icon.setTextSize(21);
        icon.setTextColor(PURPLE);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(rounded(Color.rgb(244, 240, 255), 0, 14));
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(dp(46), dp(46));
        iconParams.bottomMargin = dp(17);
        card.addView(icon, iconParams);

        TextView eyebrow = new TextView(this);
        eyebrow.setText("ПОСЛЕДНИЙ ШАГ ДО РАЗГОВОРА");
        eyebrow.setTextColor(MUTED);
        eyebrow.setTextSize(9);
        eyebrow.setLetterSpacing(0.12f);
        card.addView(eyebrow, wrapParams());

        TextView heading = new TextView(this);
        heading.setText("Подключите Нить");
        heading.setTextColor(INK);
        heading.setTextSize(24);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams headingParams = wrapParams();
        headingParams.topMargin = dp(8);
        card.addView(heading, headingParams);

        TextView description = new TextView(this);
        description.setText("Укажите публичный HTTPS-адрес работающего сервера мессенджера. Аккаунты и переписки будут доступны через этот сервер.");
        description.setTextColor(MUTED);
        description.setTextSize(13);
        description.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams descriptionParams = wrapParams();
        descriptionParams.topMargin = dp(9);
        descriptionParams.bottomMargin = dp(19);
        card.addView(description, descriptionParams);

        TextView label = new TextView(this);
        label.setText("АДРЕС САЙТА");
        label.setTextColor(Color.rgb(78, 74, 88));
        label.setTextSize(10);
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams labelParams = wrapParams();
        labelParams.bottomMargin = dp(7);
        card.addView(label, labelParams);

        serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setTextSize(13);
        serverInput.setTextColor(INK);
        serverInput.setHintTextColor(Color.rgb(176, 172, 183));
        serverInput.setHint("https://messenger.example.com");
        serverInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        serverInput.setPadding(dp(13), 0, dp(13), 0);
        serverInput.setBackground(rounded(Color.WHITE, Color.rgb(233, 230, 238), 10));
        String suggestedUrl = serverUrl.isEmpty() ? BuildConfig.DEFAULT_WEB_APP_URL : serverUrl;
        if (!suggestedUrl.isEmpty()) serverInput.setText(suggestedUrl);
        card.addView(serverInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

        errorText = new TextView(this);
        errorText.setTextColor(Color.rgb(168, 79, 71));
        errorText.setTextSize(11);
        errorText.setVisibility(View.GONE);
        LinearLayout.LayoutParams errorParams = wrapParams();
        errorParams.topMargin = dp(8);
        card.addView(errorText, errorParams);
        if (!message.isEmpty()) {
            errorText.setText(message);
            errorText.setVisibility(View.VISIBLE);
        }

        TextView connectButton = actionButton("Открыть Нить", true);
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        connectParams.topMargin = dp(17);
        card.addView(connectButton, connectParams);
        connectButton.setOnClickListener(view -> connectToServer());
        serverInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                connectToServer();
                return true;
            }
            return false;
        });

        TextView note = new TextView(this);
        boolean hasConfiguredServer = !serverUrl.isEmpty() || isValidServerUrl(BuildConfig.DEFAULT_WEB_APP_URL);
        note.setText(hasConfiguredServer
                ? "Адрес сервера сохранится на этом устройстве. Переписки синхронизируются через указанный HTTPS-сайт."
                : "Сначала разверните веб-версию мессенджера на HTTPS-сервере, затем вставьте её адрес сюда.");
        note.setTextColor(Color.rgb(164, 160, 170));
        note.setTextSize(10);
        note.setGravity(Gravity.CENTER);
        note.setLineSpacing(dp(2), 1f);
        LinearLayout.LayoutParams noteParams = wrapParams();
        noteParams.topMargin = dp(16);
        card.addView(note, noteParams);

        if (!serverUrl.isEmpty()) {
            TextView cancelButton = actionButton("Вернуться к диалогу", false);
            LinearLayout.LayoutParams cancelParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
            cancelParams.topMargin = dp(10);
            card.addView(cancelButton, cancelParams);
            cancelButton.setOnClickListener(view -> showWebView());
        }

        content.addView(scrollView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void connectToServer() {
        String candidate = serverInput.getText().toString().trim();
        if (!isValidServerUrl(candidate)) {
            errorText.setText("Введите полный HTTPS-адрес сайта, например https://messenger.example.com");
            errorText.setVisibility(View.VISIBLE);
            return;
        }
        serverUrl = normalizeUrl(candidate);
        getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .edit().putString(SERVER_URL_KEY, serverUrl).apply();
        InputMethodManager inputManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (inputManager != null) inputManager.hideSoftInputFromWindow(serverInput.getWindowToken(), 0);
        showWebView();
    }

    private boolean isValidServerUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        Uri uri = Uri.parse(value.trim());
        return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && !uri.getHost().isEmpty()
                && uri.getUserInfo() == null
                && uri.getQuery() == null
                && uri.getFragment() == null;
    }

    private String normalizeUrl(String value) {
        String normalized = value.trim();
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        return normalized;
    }

    private boolean isSameOrigin(Uri destination, String currentUrl) {
        if (currentUrl == null || currentUrl.isEmpty()) return false;
        Uri current = Uri.parse(currentUrl);
        return equalIgnoreCase(destination.getScheme(), current.getScheme())
                && equalIgnoreCase(destination.getHost(), current.getHost())
                && destination.getPort() == current.getPort();
    }

    private boolean equalIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private void openOutsideApp(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) return;
        if (!(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http")
                || scheme.equalsIgnoreCase("mailto") || scheme.equalsIgnoreCase("tel"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // No browser or compatible app is installed for this link.
        }
    }

    private TextView actionButton(String text, boolean primary) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextSize(12);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setTextColor(primary ? Color.WHITE : PURPLE);
        button.setBackground(rounded(primary ? PURPLE : Color.rgb(246, 243, 255), 0, 11));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private GradientDrawable rounded(int color, int strokeColor, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) shape.setStroke(dp(1), strokeColor);
        return shape;
    }

    private LinearLayout.LayoutParams wrapParams() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (content != null && webView != null && content.indexOfChild(webView) >= 0 && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        if (content != null && webView != null && content.indexOfChild(webView) < 0 && !serverUrl.isEmpty()) {
            showWebView();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }
}
