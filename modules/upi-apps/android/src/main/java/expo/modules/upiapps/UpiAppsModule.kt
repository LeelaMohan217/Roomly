package expo.modules.upiapps

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import androidx.core.graphics.drawable.toBitmap
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

// Icons go to JS as PNG data URIs, drawn at this many pixels square -- enough
// for a 48dp tile on a 3x screen without sending megabytes over the bridge.
private const val ICON_PX = 144

/**
 * The apps on this phone that can pay by UPI, and a way to open one.
 *
 * "Can pay by UPI" means "opens upi:// links", which is what every UPI app
 * registers -- Google Pay, PhonePe, Paytm, BHIM, and bank apps nobody would
 * think to list. Asking Android, rather than keeping a list, is the point.
 */
class UpiAppsModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RoomlyUpiApps")

    // [{ packageName, label, icon }], sorted by label. Our own package is left
    // out in case Roomly ever registers the scheme itself.
    AsyncFunction("list") {
      val pm = context.packageManager
      val probe = Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay"))

      @Suppress("DEPRECATION")
      pm.queryIntentActivities(probe, 0)
        .map { it.activityInfo.applicationInfo }
        .distinctBy { it.packageName }
        .filter { it.packageName != context.packageName }
        .map { info ->
          mapOf(
            "packageName" to info.packageName,
            "label" to pm.getApplicationLabel(info).toString(),
            "icon" to iconUri(pm.getApplicationIcon(info)),
          )
        }
        .sortedBy { it["label"]?.lowercase() }
    }

    // Opens the app at its home screen, not at a payment: there is no payee
    // to hand it. False when the app has no launcher entry or is gone.
    Function("open") { packageName: String ->
      val launch = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: return@Function false
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (appContext.currentActivity ?: context).startActivity(launch)
      true
    }
  }

  private fun iconUri(drawable: android.graphics.drawable.Drawable): String? =
    try {
      val out = ByteArrayOutputStream()
      drawable.toBitmap(ICON_PX, ICON_PX).compress(Bitmap.CompressFormat.PNG, 100, out)
      "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
      null
    }
}
