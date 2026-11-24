# Sandbox — Android-песочница

Минимальное Android-приложение-«песочница»: вводишь текст → жмёшь **Запустить** → видишь результат и лог, плюс информация об устройстве. Написано на Kotlin, использует только платформенный Android API (`android.app.Activity`), **без внешних зависимостей и AndroidX** — поэтому сборка быстрая и предсказуемая.

В репозитории настроен **GitHub Actions**, который на каждый push собирает готовый к установке `APK` и публикует его артефактом сборки (а по тегу — ещё и в GitHub Release).

![Build APK](https://github.com/tralaleotralaka-glitch/-/actions/workflows/build-apk.yml/badge.svg)

## Состав

| Путь | Что делает |
| --- | --- |
| `app/src/main/java/dev/sandbox/app/MainActivity.kt` | Экран песочницы: ввод, лог, информация об устройстве |
| `app/src/main/res/` | Layout, строки, тема, иконка |
| `app/build.gradle.kts` | AGP 8.7.3, Kotlin 2.0.21, `compileSdk 35`, `minSdk 23` |
| `.github/workflows/build-apk.yml` | Сборка APK, артефакт, публикация в Release |
| `gradle/wrapper/` | Gradle Wrapper 8.9 (нужен JDK 17) |

## Сборка в GitHub (рекомендуется)

Workflow `Build APK` запускается автоматически:

- **push** в любую ветку и **pull request** → собирается APK;
- **тег `v*`** → APK дополнительно прикладывается к версионированному Release;
- **Run workflow** вручную с галочкой `release` → создаётся тег `sandbox-build-N` и Release с APK.

**Прямые ссылки на APK:**

- свежая сборка (обновляется при каждом push): <https://github.com/tralaleotralaka-glitch/-/releases/download/sandbox-apk-latest/Sandbox-debug.apk>
- стабильная версия `v1.0.0`: <https://github.com/tralaleotralaka-glitch/-/releases/download/v1.0.0/Sandbox-debug.apk>

Где ещё скачать готовый файл:

1. Вкладка **Actions** → последний успешный run `Build APK` → секция **Artifacts** → `sandbox-apk` (zip с APK внутри).
2. Или вкладка **Releases** → релиз `Sandbox — Android APK` с файлом `Sandbox-debug.apk`.

APK подписан автоматически создаваемым debug-keystore, поэтому ставится на телефон/эмулятор сразу. Для установки может понадобиться разрешить «Установку из неизвестных источников» (это не Play Market).

## Сборка локально

Нужны JDK 17, Android SDK (`platforms;android-35`, `build-tools;34.0.0`, `platform-tools`). Переменная `ANDROID_HOME`/`ANDROID_SDK_ROOT` или `local.properties` с `sdk.dir=...`.

```bash
./gradlew assembleDebug          # Linux / macOS
gradlew.bat assembleDebug        # Windows
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Результат: `app/build/outputs/apk/debug/app-debug.apk` (debug) или `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release-unsigned.apk` (для публикации его нужно подписать своим ключом).

## Полезные команды

```bash
./gradlew tasks                 # список задач
./gradlew clean assembleDebug   # чистая сборка
./gradlew lintDebug             # статический анализ
```

> Сгенерированные `*.apk` в Git не коммитятся (см. `.gitignore`): они живут в артефактах Actions и в Release.
