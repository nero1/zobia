# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Andorid/Sdk/tools/proguard/proguard-android.txt

# ---------------------------------------------------------------------------
# Capacitor bridge (BUG-CAP-01)
#
# The Capacitor JS<->native bridge invokes plugin methods via reflection, so
# R8 must not rename/strip the bridge classes or any @CapacitorPlugin /
# @PluginMethod annotated classes and their (annotated) methods. Without
# these rules, minifyEnabled=true release builds can silently break plugin
# calls (IAP, push, AdMob) even though debug builds work fine, since debug
# builds never minify.
# ---------------------------------------------------------------------------
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keepattributes *Annotation*
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }

# First-party + community Capacitor plugin packages used by this app
# (@capacitor/app, browser, haptics, network, preferences, push-notifications,
# splash-screen, status-bar, @capacitor-community/admob).
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }

# ---------------------------------------------------------------------------
# Google Play Billing (capacitor-plugin-cdv-purchase) (BUG-CAP-01)
#
# The billing client uses AIDL-generated classes and reflection internally;
# stripping/renaming these breaks purchase flows only in minified builds.
# ---------------------------------------------------------------------------
-keep class com.android.billingclient.** { *; }
-keep interface com.android.billingclient.** { *; }
-dontwarn com.android.billingclient.**
-keep class com.android.vending.billing.** { *; }
-keep class org.apache.cordova.purchase.** { *; }

# ---------------------------------------------------------------------------
# Google Mobile Ads (AdMob) — Google's officially recommended rules.
# https://developers.google.com/admob/android/quick-start
# ---------------------------------------------------------------------------
-keep class com.google.android.gms.ads.** { *; }
-keep public class com.google.android.gms.ads.mediation.customevent.CustomEventAdapter { *; }
-dontwarn com.google.android.gms.ads.**

# ---------------------------------------------------------------------------
# Firebase Cloud Messaging (push notifications)
# ---------------------------------------------------------------------------
-keep class com.google.firebase.messaging.** { *; }
-dontwarn com.google.firebase.**

# ---------------------------------------------------------------------------
# JS interface methods invoked from the WebView must not be renamed/stripped
# ---------------------------------------------------------------------------
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
