package expo.modules.downloads

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Puts a file the app made into the phone's Downloads folder, where the Files
 * app and every file picker can see it, and opens it from there.
 *
 * Through MediaStore, which needs no storage permission from Android 10 on.
 * Older phones get null back and the app falls back to the share sheet.
 */
class DownloadsModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RoomlyDownloads")

    // Copies a file:// path in the app's own storage into Downloads under
    // `name` and returns the new content:// uri. A clash gets " (1)" from
    // Android rather than overwriting the earlier download.
    AsyncFunction("save") { source: String, name: String, mimeType: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction null

      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        // Hidden until it is fully written, so nothing opens half a file.
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create the file in Downloads")

      try {
        val input = File(Uri.parse(source).path ?: source)
        resolver.openOutputStream(target).use { out ->
          requireNotNull(out) { "Could not write to Downloads" }
          input.inputStream().use { it.copyTo(out) }
        }
        resolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      } catch (e: Exception) {
        resolver.delete(target, null, null)
        throw e
      }
      target.toString()
    }

    // Opens a saved file in whatever views that type. False when nothing on
    // the phone can (no PDF viewer, say).
    Function("open") { uri: String, mimeType: String ->
      val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(Uri.parse(uri), mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        (appContext.currentActivity ?: context).startActivity(view)
        true
      } catch (e: ActivityNotFoundException) {
        false
      }
    }
  }
}
