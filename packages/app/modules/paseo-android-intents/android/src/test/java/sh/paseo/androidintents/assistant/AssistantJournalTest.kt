package sh.paseo.androidintents.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class AssistantJournalTest {
  @get:Rule val folder = TemporaryFolder()

  private var now = 1_000_000L
  private val journal by lazy { AssistantJournal(folder.root) { now } }
  private val args = mapOf<String, Any?>("serverId" to "s", "projectId" to "p", "prompt" to "hi", "isolation" to "local")
  private val planA = mapOf("kind" to "create_agent", "request" to mapOf("worktreeSlug" to "first"))

  private fun admit(id: String) = (journal.admit(10123, id, AssistantOperation.CREATE_AGENT, args) as Admission.Created).entry

  @Test
  fun replaysAreScopedToCallerAndBoundToTheirArguments() {
    val entry = admit("eva-1")
    assertEquals(ReceiptState.ACCEPTED, entry.state)
    assertTrue(journal.admit(10123, "eva-1", AssistantOperation.CREATE_AGENT, args) is Admission.Existing)
    assertTrue(journal.admit(10123, "eva-1", AssistantOperation.CREATE_AGENT, args + ("prompt" to "x")) is Admission.Conflict)
    assertTrue(journal.admit(10123, "eva-1", AssistantOperation.SEND_PROMPT, args) is Admission.Conflict)
    assertTrue(journal.admit(10999, "eva-1", AssistantOperation.CREATE_AGENT, args) is Admission.Created)
    assertNull(journal.find(10123, "unknown"))
  }

  @Test
  fun anUnreadableRecordRefusesAdmission() {
    File(folder.root, "${journal.keyFor(10123, "eva-bad")}.json").writeText("{not json")
    assertTrue(journal.admit(10123, "eva-bad", AssistantOperation.CREATE_AGENT, args) is Admission.Conflict)
  }

  @Test
  fun theFirstPlanWinsAndDispatchCannotBeUnclaimed() {
    val key = admit("eva-2").key
    journal.update(key, ReceiptUpdate(state = "accepted", dispatchStarted = true, plan = planA))
    val second = journal.update(key, ReceiptUpdate(dispatchStarted = true, plan = mapOf("kind" to "other")))!!
    assertEquals(planA, second.plan)
    val claimed = journal.update(key, ReceiptUpdate(state = ReceiptState.REJECTED, errorCode = "unknown_host"))!!
    assertEquals(ReceiptState.UNCERTAIN, claimed.state)
    assertEquals(ReceiptState.UNCERTAIN, journal.update(key, ReceiptUpdate(state = ReceiptState.COMPLETED))!!.state)
  }

  @Test
  fun dispatchIsOnlyRecordedWithAPlan() {
    val entry = journal.update(admit("eva-3").key, ReceiptUpdate(state = ReceiptState.REJECTED, dispatchStarted = true))!!
    assertEquals(ReceiptState.REJECTED, entry.state)
    assertFalse(entry.dispatchStarted)
  }

  @Test
  fun submittedNeverRegressesAndStaleErrorsClear() {
    val key = admit("eva-4").key
    journal.update(key, ReceiptUpdate(state = ReceiptState.WAITING_FOR_HOST, errorCode = "host_offline", errorMessage = "offline"))
    journal.update(key, ReceiptUpdate(state = ReceiptState.ACCEPTED, dispatchStarted = true, plan = planA))
    val submitted = journal.update(key, ReceiptUpdate(state = ReceiptState.SUBMITTED, workspaceId = "ws"))!!
    assertNull(submitted.errorCode)
    assertEquals(ReceiptState.SUBMITTED, journal.update(key, ReceiptUpdate(state = ReceiptState.WAITING_FOR_HOST))!!.state)
    val done = journal.update(key, ReceiptUpdate(state = ReceiptState.COMPLETED, agentId = "ag"))!!
    assertEquals(listOf("ws", "ag", false), listOf(done.workspaceId, done.agentId, done.receipt()["pollable"]))
    assertEquals(ReceiptState.COMPLETED, AssistantJournal(folder.root) { now }.get(key)!!.state)
  }

  @Test
  fun overdueRequestsCloseAsExpiredOnlyWhenNothingWasSent() {
    val unsent = admit("eva-5").key
    val sent = admit("eva-6").key
    journal.update(sent, ReceiptUpdate(state = ReceiptState.ACCEPTED, dispatchStarted = true, plan = planA))
    now += 11 * 60 * 1000L
    assertEquals(ReceiptState.EXPIRED, journal.expireIfOverdue(unsent)!!.state)
    assertEquals(ReceiptState.UNCERTAIN, journal.expireIfOverdue(sent)!!.state)
  }

  @Test
  fun awaitChangeWakesOnUpdate() {
    val entry = admit("eva-7")
    Thread {
      Thread.sleep(50)
      journal.update(entry.key, ReceiptUpdate(state = ReceiptState.SUBMITTED))
    }.start()
    assertEquals(ReceiptState.SUBMITTED, journal.awaitChange(entry.key, entry.revision, now + 5_000)!!.state)
  }
}
