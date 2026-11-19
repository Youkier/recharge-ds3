// Coque Android (phase 3b, lot C3). Un seul module à la racine de android/.
// Dépôts : google() et mavenCentral() seulement (cahier des charges, § 5). Aucun plugin Kotlin à part : depuis AGP 9.0
// le support de Kotlin est intégré (developer.android.com/build/migrate-to-built-in-kotlin).
pluginManagement {
    repositories {
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "coque"
