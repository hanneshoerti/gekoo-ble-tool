plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.gekooble.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.gekooble.app"
        minSdk = 29          // Android 10
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
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
