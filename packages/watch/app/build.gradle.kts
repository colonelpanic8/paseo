plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "sh.paseo.watch"
  compileSdk = 36

  defaultConfig {
    applicationId = "sh.paseo.watch"
    // Wear OS 3.0. Below this the Compose-for-Wear vocabulary and the standalone
    // app model don't apply.
    minSdk = 30
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlin {
    compilerOptions {
      jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
  }

  buildFeatures {
    compose = true
  }
}

dependencies {
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.ui.graphics)
  implementation(libs.compose.foundation)
  implementation(libs.compose.ui.tooling.preview)
  debugImplementation(libs.compose.ui.tooling)

  implementation(libs.activity.compose)

  implementation(libs.wear.compose.material)
  implementation(libs.wear.compose.foundation)
  implementation(libs.wear.compose.navigation)

  implementation(libs.play.services.wearable)
  implementation(libs.kotlinx.serialization.json)
  implementation(libs.kotlinx.coroutines.play.services)
  implementation(libs.lifecycle.runtime.compose)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.kotlinx.coroutines.test)
}
