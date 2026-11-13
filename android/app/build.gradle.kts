plugins {
    id("com.android.application")
}

// Version: GitHub Actions übergibt bei einem Release dessen Namen (-PappVersion=0.3.0).
// Lokal gilt der Wert hier. versionCode wird daraus berechnet (0.3.0 → 300), damit Updates
// zwischen selbst gebauten und Release-APKs funktionieren.
val appVersionName: String = ((findProperty("appVersion") as String?) ?: "0.3.0").removePrefix("v")
val appVersionCode: Int = appVersionName.split(".", "-")
    .mapNotNull { it.toIntOrNull() }
    .let { p -> p.getOrElse(0) { 0 } * 10000 + p.getOrElse(1) { 0 } * 100 + p.getOrElse(2) { 0 } }
    .coerceAtLeast(1)

android {
    namespace = "io.github.gekooble.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.gekooble.app"
        minSdk = 29          // Android 10
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }

    // Fester, absichtlich öffentlicher Schlüssel: Alle Builds (Android Studio, GitHub Actions)
    // sind gleich signiert, damit Updates ohne Deinstallieren funktionieren.
    // Für ein privates Fork einen eigenen Schlüssel erzeugen.
    signingConfigs {
        create("community") {
            storeFile = rootProject.file("signing.keystore")
            storePassword = "gekoo-ble-tool"
            keyAlias = "gekoo"
            keyPassword = "gekoo-ble-tool"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("community")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("community")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
