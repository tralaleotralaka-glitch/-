plugins {
    id("com.android.application")
}

val webAppUrl = providers.gradleProperty("webAppUrl")
    .orElse(providers.environmentVariable("WEB_APP_URL"))
    .getOrElse("")
    .trim()
val configuredUri = if (webAppUrl.isEmpty()) null else runCatching {
    java.net.URI(webAppUrl)
}.getOrElse {
    throw GradleException("webAppUrl must be a valid public HTTPS URL")
}
require(configuredUri == null || (
    configuredUri.scheme?.equals("https", ignoreCase = true) == true
        && !configuredUri.host.isNullOrBlank()
        && configuredUri.rawUserInfo == null
        && configuredUri.rawQuery == null
        && configuredUri.rawFragment == null
)) { "webAppUrl must be a public HTTPS URL without a query or fragment" }

val escapedWebAppUrl = webAppUrl
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\n", "\\n")
    .replace("\r", "\\r")

android {
    namespace = "ru.nit.messenger"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.nit.messenger"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "DEFAULT_WEB_APP_URL", "\"$escapedWebAppUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
