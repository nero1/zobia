import { Browser } from "@capacitor/browser";
import { env } from "@/lib/env";
import { OAUTH_CALLBACK_LINK } from "@/lib/deeplinks/routes";
import { beginOAuthAttempt, endOAuthAttempt } from "@/lib/auth/preAuth";

export async function signInWithGoogle(): Promise<void> {
  beginOAuthAttempt();
  try {
    await Browser.open({
      url: `${env.VITE_API_BASE_URL}/api/auth/google?redirect=${encodeURIComponent(OAUTH_CALLBACK_LINK)}`,
      presentationStyle: "popover",
    });
  } catch (error) {
    endOAuthAttempt();
    throw error;
  }
}
