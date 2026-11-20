// Coque Android minimale (phase 3b, lot C3) : une activité, une WebView, un pont TCP.
// Versions figées. Sources (developer.android.com, relevées le 2026-11-19) :
//   AGP 9.5.1       build/releases/gradle-plugin : AGP 9.5 demande Gradle 9.6.0 au moins, JDK 17, SDK Build Tools 36.0.0 ;
//                   API 37 au plus. Kotlin est intégré à AGP depuis 9.0 : pas de plugin org.jetbrains.kotlin.android.
//   androidx.webkit 1.18.0   jetpack/androidx/releases/webkit : dernière version stable (2026-10-21).
//   JUnit 4.13.2    dernière version de JUnit 4 (Maven Central) ; training/testing/local-tests ne donne pas de numéro.
plugins {
    id("com.android.application") version "9.5.1"
}

android {
    namespace = "fr.rechargeds3.coque"
    compileSdk = 36

    defaultConfig {
        applicationId = "fr.rechargeds3.coque"
        minSdk = 35
        targetSdk = 36 // < 37 : l'accès au réseau local reste accordé avec INTERNET, pas d'ACCESS_LOCAL_NETWORK (décision du 2026-11-18)
        // Numéro de la construction GitHub Actions : chaque APK publié dépasse le précédent, ce qui permet
        // de vérifier l'installation par-dessus (mise à jour n+1). En local, 1.
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.3.0-c3"
    }

    // Les fichiers embarqués sont copiés par `node tools/assets-apk.mjs` (liste blanche) dans dist/apk-assets, jamais ailleurs.
    sourceSets {
        getByName("main") {
            assets.directories.add("../dist/apk-assets")
        }
    }

    // Pas de lint à la construction de la version publiée : le premier passage se fait à l'aveugle (C3.4 pourra l'ajouter).
    lint {
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0") // seule dépendance d'exécution : WebViewAssetLoader et addWebMessageListener
    testImplementation("junit:junit:4.13.2")
}

// Garde-fou : sans la copie par liste blanche, l'APK embarquerait une page d'essai absente ou périmée.
val verifierAssets by tasks.registering {
    val index = layout.projectDirectory.file("../dist/apk-assets/android/essai/index.html")
    doFirst {
        if (!index.asFile.exists()) {
            throw GradleException("dist/apk-assets est absent : lancez d'abord « node tools/assets-apk.mjs ».")
        }
    }
}
tasks.named("preBuild") { dependsOn(verifierAssets) }
