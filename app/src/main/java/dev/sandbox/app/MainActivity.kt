package dev.sandbox.app

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A tiny playground ("sandbox") screen: type text, run it, watch the log.
 * Uses only the Android framework, so the project has zero third-party dependencies.
 */
class MainActivity : Activity() {

    private lateinit var input: EditText
    private lateinit var log: TextView
    private var runCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        input = findViewById(R.id.input)
        log = findViewById(R.id.log)

        findViewById<TextView>(R.id.deviceInfo).text = deviceInfo()

        findViewById<Button>(R.id.runButton).setOnClickListener { runSandbox() }
        findViewById<Button>(R.id.clearButton).setOnClickListener {
            log.text = ""
            appendLog(getString(R.string.log_cleared))
        }

        appendLog(getString(R.string.log_ready))
    }

    private fun runSandbox() {
        val value = input.text.toString().trim()
        runCount++

        if (value.isEmpty()) {
            appendLog(getString(R.string.log_empty, runCount))
            return
        }

        appendLog(getString(R.string.log_input, runCount, value))
        appendLog(getString(R.string.log_length, value.length))
        appendLog(getString(R.string.log_upper, value.uppercase(Locale.getDefault())))
        appendLog(getString(R.string.log_reversed, value.reversed()))
    }

    private fun appendLog(line: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        log.append("[$time] $line\n")
    }

    private fun deviceInfo(): String = buildString {
        appendLine(getString(R.string.device_title))
        appendLine(getString(R.string.device_android, Build.VERSION.RELEASE, Build.VERSION.SDK_INT))
        appendLine(getString(R.string.device_hardware, Build.MANUFACTURER, Build.MODEL))
        append(getString(R.string.device_app, packageName, BuildConfig.VERSION_NAME))
    }
}
