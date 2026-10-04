package sh.paseo.androidintents

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.CancellationSignal
import android.os.Binder
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import sh.paseo.androidintents.assistant.CreatedCatalogRows
import sh.paseo.androidintents.assistant.parseIsoTimestamp

private const val DEFAULT_LIMIT = 25
private const val MAX_LIMIT = 100
private const val MESSAGE_DEFAULT_LIMIT = 10
private const val MESSAGE_MAX_LIMIT = 50
// Creations older than this are in any catalog published since; skip their journal files.
private const val CREATED_ROWS_MAX_AGE_MS = 24 * 60 * 60 * 1000L
// Leaves room for a cold React Native start and a host round trip.
private const val MESSAGE_TIMEOUT_MS = 17_000L
private const val UNAVAILABLE_NOTICE =
  "Paseo could not read the conversation in time; ask again in a moment."

private val PROJECT_COLUMNS = listOf("id", "serverId", "serverName", "name", "kind")
private val WORKSPACE_COLUMNS =
  listOf("id", "serverId", "serverName", "name", "project", "repository", "branch", "status", "agentCount", "lastActivityAt")
private val AGENT_COLUMNS =
  listOf("id", "serverId", "serverName", "workspaceId", "name", "provider", "status", "lastActivityAt")
private val MESSAGE_COLUMNS =
  listOf("id", "serverId", "serverName", "workspaceId", "agentId", "agentName", "kind", "createdAt", "text")
private val MODEL_COLUMNS =
  listOf(
    "serverId", "serverName", "provider", "providerLabel", "status", "model", "modelLabel", "isDefault",
    "thinkingOptions", "defaultThinkingOption", "modes", "defaultMode", "note",
  )
private val INT_COLUMNS = setOf("agentCount", "isDefault")
private const val MODEL_UNAVAILABLE_NOTICE = "Paseo could not read that host's models in time; ask again in a moment."

/**
 * Read-only view of what the app knows, for on-device assistants that can
 * query a content provider but not run code here.
 * `content://<authority>/workspaces?q=&limit=` and `/agents?workspaceId=&q=&limit=`
 * are served from the file [AssistantCatalogStore] holds, so they answer
 * without starting React Native. `/messages?agentId=&workspaceId=&limit=` needs
 * live transcripts, and `/models?serverId=&projectId=&provider=&q=&limit=` a live
 * provider snapshot; both go through [AssistantQueryBridge], which starts the
 * JavaScript runtime headless when the app is not running. The
 * authority is declared by the app's config plugin so a debug build can install
 * beside a release build. Only query parameters filter: a SQL selection is
 * refused rather than ignored.
 */
class AssistantContentProvider : ContentProvider() {
  private var authority: String = ""

  override fun attachInfo(context: Context, info: ProviderInfo) {
    super.attachInfo(context, info)
    authority = info.authority
  }

  override fun onCreate(): Boolean = true

  override fun getType(uri: Uri): String? =
    when (uri.pathSegments.singleOrNull()) {
      "projects" -> "vnd.android.cursor.dir/vnd.$authority.project"
      "workspaces" -> "vnd.android.cursor.dir/vnd.$authority.workspace"
      "agents" -> "vnd.android.cursor.dir/vnd.$authority.agent"
      "messages" -> "vnd.android.cursor.dir/vnd.$authority.message"
      "models" -> "vnd.android.cursor.dir/vnd.$authority.model"
      else -> null
    }

  override fun query(
    uri: Uri,
    projection: Array<String>?,
    selection: String?,
    selectionArgs: Array<String>?,
    sortOrder: String?,
    cancellationSignal: CancellationSignal?,
  ): Cursor = query(uri, projection, selection, selectionArgs, sortOrder)

  override fun query(
    uri: Uri,
    projection: Array<String>?,
    selection: String?,
    selectionArgs: Array<String>?,
    sortOrder: String?,
  ): Cursor {
    if (!isAuthorizedCaller()) {
      throw SecurityException("Caller is not an allowed assistant")
    }
    require(uri.authority == authority) { "Unknown authority ${uri.authority}" }
    require(selection.isNullOrEmpty() && selectionArgs.isNullOrEmpty()) {
      "Filter with query parameters; selections are not supported"
    }
    require(sortOrder.isNullOrEmpty()) { "Sorting is fixed to most recent activity" }
    return when (uri.pathSegments.singleOrNull()) {
      "projects" -> queryCatalog("projects", PROJECT_COLUMNS, uri, projection)
      "workspaces" -> queryCatalog("workspaces", WORKSPACE_COLUMNS, uri, projection)
      "agents" -> queryCatalog("agents", AGENT_COLUMNS, uri, projection)
      "messages" -> queryMessages(uri, projection)
      "models" -> queryModels(uri, projection)
      else -> throw IllegalArgumentException("Unknown table ${uri.path}")
    }
  }

  private fun isAuthorizedCaller(): Boolean {
    val appContext = context ?: return false
    val caller = callingPackage ?: return false
    return AssistantCallerPolicy.isAuthorized(appContext, Binder.getCallingUid(), caller)
  }

  private fun queryCatalog(
    table: String,
    columns: List<String>,
    uri: Uri,
    projection: Array<String>?,
  ): Cursor {
    val requested = requestedColumns(projection, columns)
    val limit = parseLimit(uri.getQueryParameter("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    val query = uri.getQueryParameter("q")?.trim()?.lowercase()?.ifEmpty { null }
    val workspaceId = uri.getQueryParameter("workspaceId")?.trim()?.ifEmpty { null }
    val serverId = uri.getQueryParameter("serverId")?.trim()?.ifEmpty { null }
    require(table == "agents" || workspaceId == null) { "workspaceId only filters agents" }

    val catalog = readCatalog()
    val published = catalog?.optJSONArray(table).toList()
    val rows =
      (createdRows(table, catalog, published) + published).filter { row ->
        (workspaceId == null || row.optString("workspaceId") == workspaceId) &&
          (serverId == null || row.optString("serverId") == serverId) &&
          (query == null || columns.any { column -> row.optString(column).lowercase().contains(query) })
      }
    val cursor = MatrixCursor(requested.toTypedArray(), minOf(rows.size, limit))
    for (row in rows.take(limit)) {
      cursor.addRow(
        requested.map { column ->
          when {
            column in INT_COLUMNS -> row.optInt(column)
            row.isNull(column) -> null
            else -> row.optString(column)
          }
        },
      )
    }
    return cursor
  }

  /**
   * Asks the running app for the newest messages. Anything that keeps the app
   * from answering is a single notice row, not an exception: an assistant can
   * read a sentence out loud but cannot act on a failed query.
   */
  private fun queryMessages(uri: Uri, projection: Array<String>?): Cursor {
    val requested = requestedColumns(projection, MESSAGE_COLUMNS)
    val agentId = uri.getQueryParameter("agentId")?.trim()?.ifEmpty { null }
    val workspaceId = uri.getQueryParameter("workspaceId")?.trim()?.ifEmpty { null }
    val serverId = uri.getQueryParameter("serverId")?.trim()?.ifEmpty { null }
    require(agentId != null || workspaceId != null) { "Pass agentId or workspaceId" }
    val limit = parseLimit(uri.getQueryParameter("limit"), MESSAGE_DEFAULT_LIMIT, MESSAGE_MAX_LIMIT)
    val scopedWorkspaceId = if (agentId == null) workspaceId else null

    val appContext = context ?: return noticeCursor(requested, agentId, scopedWorkspaceId, serverId, UNAVAILABLE_NOTICE)
    val answer =
      AssistantQueryBridge.request(
        appContext,
        "messages",
        mapOf("agentId" to agentId, "workspaceId" to scopedWorkspaceId, "serverId" to serverId, "limit" to limit),
        MESSAGE_TIMEOUT_MS,
      )
    val rows = answer?.let(::parseMessageRows)
      ?: return noticeCursor(requested, agentId, scopedWorkspaceId, serverId, UNAVAILABLE_NOTICE)

    val cursor = MatrixCursor(requested.toTypedArray(), minOf(rows.size, limit))
    for (row in rows.take(limit)) {
      cursor.addRow(requested.map { column -> if (row.isNull(column)) null else row.optString(column) })
    }
    return cursor
  }

  /** The host's live provider snapshot, one row per model; failures are a single notice row. */
  private fun queryModels(uri: Uri, projection: Array<String>?): Cursor {
    val requested = requestedColumns(projection, MODEL_COLUMNS)
    val serverId = requireNotNull(uri.getQueryParameter("serverId")?.trim()?.ifEmpty { null }) { "Pass serverId" }
    val limit = parseLimit(uri.getQueryParameter("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    val params =
      mapOf(
        "serverId" to serverId,
        "projectId" to uri.getQueryParameter("projectId")?.trim()?.ifEmpty { null },
        "provider" to uri.getQueryParameter("provider")?.trim()?.ifEmpty { null },
        "q" to uri.getQueryParameter("q")?.trim()?.ifEmpty { null },
        "limit" to limit,
      )
    val rows =
      context?.let { AssistantQueryBridge.request(it, "models", params, MESSAGE_TIMEOUT_MS) }?.let(::parseMessageRows)
        ?: listOf(JSONObject(mapOf("serverId" to serverId, "status" to "notice", "note" to MODEL_UNAVAILABLE_NOTICE)))
    val cursor = MatrixCursor(requested.toTypedArray(), minOf(rows.size, limit))
    for (row in rows.take(limit)) {
      cursor.addRow(
        requested.map { column ->
          when (column) {
            in INT_COLUMNS -> row.optInt(column)
            else -> row.optString(column)
          }
        },
      )
    }
    return cursor
  }

  private fun parseMessageRows(json: String): List<JSONObject>? =
    try {
      JSONObject(json).optJSONArray("rows")?.toList()
    } catch (_: JSONException) {
      null
    }

  private fun noticeCursor(
    requested: List<String>,
    agentId: String?,
    workspaceId: String?,
    serverId: String?,
    text: String,
  ): Cursor {
    val values =
      mapOf(
        "id" to "notice",
        "serverId" to (serverId ?: ""),
        "serverName" to "",
        "workspaceId" to workspaceId,
        "agentId" to (agentId ?: ""),
        "agentName" to "",
        "kind" to "notice",
        "createdAt" to null,
        "text" to text,
      )
    val cursor = MatrixCursor(requested.toTypedArray(), 1)
    cursor.addRow(requested.map { column -> values[column] })
    return cursor
  }

  private fun requestedColumns(projection: Array<String>?, columns: List<String>): List<String> {
    val requested = projection?.toList() ?: columns
    val unknown = requested.filterNot { it in columns }
    require(unknown.isEmpty()) { "Unknown columns ${unknown.joinToString()}" }
    return requested
  }

  private fun parseLimit(raw: String?, default: Int, max: Int): Int {
    if (raw == null) return default
    val limit = raw.toIntOrNull()
    require(limit != null && limit in 1..max) { "limit must be 1..$max" }
    return limit
  }

  /**
   * What assistant requests created since the catalog was captured and it
   * does not list yet, ahead of the published rows because it is newer.
   */
  private fun createdRows(table: String, catalog: JSONObject?, published: List<JSONObject>): List<JSONObject> {
    val context = context ?: return emptyList()
    val capturedAtMs = catalog?.optString("capturedAt")?.let(::parseIsoTimestamp)
    val since = maxOf(capturedAtMs ?: 0L, System.currentTimeMillis() - CREATED_ROWS_MAX_AGE_MS)
    val entries = AssistantJobs.journal(context).creationsSince(since)
    if (entries.isEmpty()) return emptyList()
    val listed = published.mapTo(HashSet()) { it.optString("serverId") to it.optString("id") }
    return CreatedCatalogRows.rows(table, entries, listed, capturedAtMs).map { JSONObject(it) }
  }

  private fun readCatalog(): JSONObject? {
    val context = context ?: return null
    val json = AssistantCatalogStore.read(context) ?: return null
    return try {
      JSONObject(json)
    } catch (_: JSONException) {
      null
    }
  }

  private fun JSONArray?.toList(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optJSONObject(it) }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("read-only")

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int =
    throw UnsupportedOperationException("read-only")

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int =
    throw UnsupportedOperationException("read-only")
}
