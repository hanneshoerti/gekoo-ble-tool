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

    buildTypes {
        release {
            isMinifyEnabled = false
            // Für den Eigengebrauch mit dem Debug-Schlüssel signiert, damit die APK direkt installierbar ist.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
