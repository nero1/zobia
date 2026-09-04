package com.zobiasocial.app;

import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SecureTokenStorePlugin
 *
 * Stores the JWT access token and refresh token in an EncryptedSharedPreferences
 * file whose AES-256 key is generated and held by the Android Keystore
 * (MasterKey.KeyScheme.AES256_GCM) — hardware-backed on devices that support it.
 *
 * This replaces the previous approach of keeping those tokens in the plain
 * @capacitor/preferences SharedPreferences file and only excluding that file
 * from Android's backup/device-transfer mechanisms (see data_extraction_rules.xml
 * and full_backup_content.xml). Backup exclusion only stops the tokens leaving
 * the device via the *sanctioned* backup path; it does nothing against a
 * rooted device, a malicious app with storage access, or any other read of
 * the plaintext SharedPreferences XML file. Encrypting at rest with a
 * Keystore-backed key closes that gap: the ciphertext is useless without the
 * key, and the key itself never leaves the device's secure hardware.
 *
 * The encrypted file is still excluded from backup/transfer (see the same two
 * XML resources) for a different reason: Keystore keys are hardware-bound and
 * never included in a backup, so a restored-but-undecryptable blob on a new
 * device would just throw on every read — excluding it avoids that failure
 * mode entirely and simply leaves the restored install logged out.
 */
@CapacitorPlugin(name = "SecureTokenStore")
public class SecureTokenStorePlugin extends Plugin {

    private static final String PREFS_FILE_NAME = "zobia_secure_tokens";

    private SharedPreferences encryptedPrefs;

    private SharedPreferences getEncryptedPrefs() throws Exception {
        if (encryptedPrefs == null) {
            MasterKey masterKey = new MasterKey.Builder(getContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();

            encryptedPrefs = EncryptedSharedPreferences.create(
                getContext(),
                PREFS_FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        }
        return encryptedPrefs;
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            getEncryptedPrefs().edit().putString(key, value).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to write secure value", e);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key is required");
            return;
        }
        try {
            String value = getEncryptedPrefs().getString(key, null);
            JSObject ret = new JSObject();
            ret.put("value", value);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read secure value", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null) {
            call.reject("key is required");
            return;
        }
        try {
            getEncryptedPrefs().edit().remove(key).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to remove secure value", e);
        }
    }
}
