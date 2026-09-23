package sh.paseo.androidintents.assistant

class InvalidArgumentsException(message: String) : IllegalArgumentException(message)

enum class AssistantOperation(val wire: String) {
  CREATE_AGENT("create_agent"),
  SEND_PROMPT("send_prompt");

  companion object {
    fun fromWire(value: String): AssistantOperation? = values().firstOrNull { it.wire == value }
  }
}

const val REQUEST_STATUS_CAPABILITY = "request_status"
const val MAX_PROMPT_LENGTH = 16_000

private const val ID_MAX = 200
private val SLUG = Regex("[a-z0-9][a-z0-9-]{0,62}")

sealed class Field(val name: String, val description: String) {
  abstract fun schema(): Map<String, Any?>

  abstract fun validate(value: Any?): Any

  class Text(
    name: String,
    description: String,
    private val min: Int = 1,
    private val max: Int = ID_MAX,
    private val pattern: Regex? = null,
  ) : Field(name, description) {
    // EVA's schema dialect has no "pattern"; [pattern] is enforced here only.
    override fun schema(): Map<String, Any?> =
      linkedMapOf("type" to "string", "minLength" to min, "maxLength" to max, "description" to description)

    override fun validate(value: Any?): Any {
      val text = value as? String ?: throw InvalidArgumentsException("$name must be a string")
      val length = text.codePointCount(0, text.length)
      if (length < min || length > max) throw InvalidArgumentsException("$name must be $min to $max characters")
      if (text.isBlank()) throw InvalidArgumentsException("$name must not be blank")
      if (pattern != null && !pattern.matches(text)) throw InvalidArgumentsException("$name has an invalid format")
      return text
    }
  }

  class Choice(name: String, description: String, private val values: List<String>) : Field(name, description) {
    override fun schema(): Map<String, Any?> = linkedMapOf("type" to "string", "enum" to values, "description" to description)

    override fun validate(value: Any?): Any {
      val text = value as? String ?: throw InvalidArgumentsException("$name must be a string")
      if (text !in values) throw InvalidArgumentsException("$name must be one of ${values.joinToString()}")
      return text
    }
  }

  class Whole(name: String, description: String, private val min: Long, private val max: Long) : Field(name, description) {
    // Range is enforced here only; keep EVA's schema dialect minimal.
    override fun schema(): Map<String, Any?> = linkedMapOf("type" to "integer", "description" to description)

    override fun validate(value: Any?): Any {
      val number = value as? Long ?: throw InvalidArgumentsException("$name must be an integer")
      if (number < min || number > max) throw InvalidArgumentsException("$name must be $min to $max")
      return number
    }
  }
}

class Capability(
  val name: String,
  val title: String,
  val description: String,
  val effects: String,
  val maxWaitMillis: Long,
  val fields: List<Field>,
  val required: List<String>,
) {
  fun inputSchema(): Map<String, Any?> =
    linkedMapOf(
      "type" to "object",
      "properties" to fields.associate { it.name to it.schema() },
      "required" to required,
      "additionalProperties" to false,
    )

  /** Rejects unknown, missing, and mistyped fields; returns only the fields that were sent. */
  fun validate(arguments: Map<String, Any?>): Map<String, Any?> {
    val known = fields.associateBy { it.name }
    val unknown = arguments.keys.filterNot { it in known }
    if (unknown.isNotEmpty()) throw InvalidArgumentsException("Unknown argument ${unknown.first()}")
    for (name in required) {
      if (arguments[name] == null) throw InvalidArgumentsException("$name is required")
    }
    val result = LinkedHashMap<String, Any?>()
    for ((name, value) in arguments) {
      // Absent and null mean the same thing for optional fields.
      if (value == null) continue
      result[name] = known.getValue(name).validate(value)
    }
    return result
  }
}

private val serverId = Field.Text("serverId", "Host ID from the Paseo projects, workspaces, or agents catalog.")
private val prompt = Field.Text("prompt", "The message to send to the agent.", max = MAX_PROMPT_LENGTH)

object AssistantCapabilities {
  val createAgent =
    Capability(
      name = AssistantOperation.CREATE_AGENT.wire,
      title = "Start a Paseo agent",
      description =
        "Create a workspace in a Paseo project and start a coding agent on it with an initial prompt. " +
          "Use serverId and projectId exactly as listed by the Paseo projects catalog. " +
          "state=completed means the agent received the prompt, not that its task is done. " +
          "accepted, submitted, or waiting_for_host mean Paseo is still working on it: call request_status " +
          "with this invocation's ID instead of calling create_agent again.",
      effects = "write",
      maxWaitMillis = 25_000,
      fields =
        listOf(
          serverId,
          Field.Text("projectId", "Project ID from the Paseo projects catalog, for the same serverId."),
          prompt,
          Field.Choice("isolation", "local runs in the project directory; worktree creates a new git worktree.", listOf("local", "worktree")),
          Field.Choice(
            "worktreeMode",
            "Only with isolation=worktree. branch-off (default) makes a new branch; checkout-branch uses branch; checkout-pr uses prNumber.",
            listOf("branch-off", "checkout-branch", "checkout-pr"),
          ),
          Field.Text("baseRef", "Only with worktreeMode=branch-off: ref to branch from. Defaults to the project's current upstream branch.", max = 300),
          Field.Text("branch", "Required with worktreeMode=checkout-branch: existing branch to check out.", max = 300),
          Field.Whole("prNumber", "Required with worktreeMode=checkout-pr: pull request number, 1 or more.", 1, 1_000_000_000),
          Field.Text("forge", "Only with worktreeMode=checkout-pr: forge ID such as github. Defaults to github.", max = 40),
          Field.Text(
            "worktreeSlug",
            "Only with isolation=worktree: name for the worktree. Lowercase letters, digits and hyphens; starts with a letter or digit.",
            max = 63,
            pattern = SLUG,
          ),
          Field.Text("provider", "Agent provider ID. Defaults to the provider last chosen in Paseo's New workspace form."),
          Field.Text("model", "Model ID. Defaults to the provider's saved model, else the provider default."),
          Field.Text("modeId", "Permission mode ID. Defaults to the provider's default mode; saved modes are never applied unattended."),
          Field.Text("thinkingOptionId", "Thinking option ID for the model."),
          Field.Text("title", "Workspace title.", max = 200),
        ),
      required = listOf("serverId", "projectId", "prompt", "isolation"),
    )

  val sendPrompt =
    Capability(
      name = AssistantOperation.SEND_PROMPT.wire,
      title = "Send a prompt to a Paseo agent",
      description =
        "Send a message to an existing Paseo agent. Use serverId and agentId from the Paseo agents catalog. " +
          "state=completed means the agent accepted the message and started its turn. " +
          "accepted or waiting_for_host mean Paseo is still delivering it: call request_status with this invocation's ID " +
          "instead of sending again.",
      effects = "write",
      maxWaitMillis = 25_000,
      fields =
        listOf(
          serverId,
          Field.Text("agentId", "Agent ID from the Paseo agents catalog, for the same serverId."),
          prompt,
          Field.Choice(
            "activeTurnBehavior",
            "What to do if the agent is mid-turn: steer (default) adds the message to the running turn; interrupt stops it first.",
            listOf("steer", "interrupt"),
          ),
        ),
      required = listOf("serverId", "agentId", "prompt"),
    )

  val requestStatus =
    Capability(
      name = REQUEST_STATUS_CAPABILITY,
      title = "Check a Paseo request",
      description =
        "Report the current state of an earlier create_agent or send_prompt call by its invocation ID. " +
          "If that request is still pending, Paseo continues it under the same idempotency key; it never starts a second one.",
      effects = "read",
      maxWaitMillis = 10_000,
      fields = listOf(Field.Text("invocationId", "The invocation ID of the earlier create_agent or send_prompt call.", max = 256)),
      required = listOf("invocationId"),
    )

  val all = listOf(createAgent, sendPrompt, requestStatus)

  fun byName(name: String): Capability? = all.firstOrNull { it.name == name }

  /** Field combinations the flat schema cannot express. */
  fun checkCreateAgentCombination(arguments: Map<String, Any?>) {
    val worktreeFields = listOf("worktreeMode", "baseRef", "branch", "prNumber", "forge", "worktreeSlug")
    if (arguments["isolation"] == "local") {
      val stray = worktreeFields.firstOrNull { arguments.containsKey(it) }
      if (stray != null) throw InvalidArgumentsException("$stray requires isolation=worktree")
      return
    }
    val mode = arguments["worktreeMode"] as String? ?: "branch-off"
    val allowed =
      when (mode) {
        "branch-off" -> setOf("baseRef")
        "checkout-branch" -> setOf("branch")
        else -> setOf("prNumber", "forge")
      }
    val stray = listOf("baseRef", "branch", "prNumber", "forge").firstOrNull { arguments.containsKey(it) && it !in allowed }
    if (stray != null) throw InvalidArgumentsException("$stray does not apply to worktreeMode=$mode")
    if (mode == "checkout-branch" && !arguments.containsKey("branch")) {
      throw InvalidArgumentsException("branch is required for worktreeMode=checkout-branch")
    }
    if (mode == "checkout-pr" && !arguments.containsKey("prNumber")) {
      throw InvalidArgumentsException("prNumber is required for worktreeMode=checkout-pr")
    }
  }
}
