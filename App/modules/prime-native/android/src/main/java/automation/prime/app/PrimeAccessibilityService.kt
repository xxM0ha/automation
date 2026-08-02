package automation.prime.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The accessibility service — the engine that reads other apps' screens and
 * dispatches gestures, all without root.
 *
 * It exposes the primitives the TypeScript interpreter needs: launch an app,
 * wait for an element, tap, scroll, read text, and extract a scrolling list.
 * [PrimeNativeModule] is the thin JS bridge in front of these.
 */
class PrimeAccessibilityService : AccessibilityService() {

  // ---- lifecycle ----------------------------------------------------------

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    PrimeNativeModule.notifyAccessibilityState(true)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    // Track the foreground app so the engine knows which target it is on.
    if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      event.packageName?.let { foregroundPackage = it.toString() }
    }
  }

  override fun onInterrupt() {
    // Required override. Nothing to do — the engine reads the tree on demand.
  }

  override fun onDestroy() {
    super.onDestroy()
    if (instance === this) instance = null
    PrimeNativeModule.notifyAccessibilityState(false)
  }

  // ---- primitives ---------------------------------------------------------

  /** Opens an app by package name. Returns false if it is not installed. */
  fun launchApp(packageName: String): Boolean {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(intent)
    return true
  }

  /** Polls the foreground package until it matches, or returns false on timeout. */
  fun waitForApp(packageName: String, timeoutMs: Long): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (currentForegroundPackage() == packageName) return true
      Thread.sleep(POLL_INTERVAL_MS)
    }
    return false
  }

  /** Read the foreground package from the live window. */
  fun currentForegroundPackage(): String? =
    rootInActiveWindow?.packageName?.toString() ?: foregroundPackage

  /** Polls until an element matching the selector appears, or times out. */
  fun waitForElement(selector: Sel, timeoutMs: Long): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (findFirst(rootInActiveWindow, selector) != null) return true
      Thread.sleep(POLL_INTERVAL_MS)
    }
    return false
  }

  /** Finds and taps an element. Returns false if it was not found. */
  fun tapElement(selector: Sel): Boolean {
    val node = findFirst(rootInActiveWindow, selector) ?: return false
    return tapNode(node)
  }

  /** Scrolls the matched (or nearest scrollable) container. */
  fun scrollElement(selector: Sel, direction: String): Boolean {
    val node = findFirst(rootInActiveWindow, selector) ?: return false
    val scrollable = if (node.isScrollable) node else findScrollable(node)
    scrollable ?: return false
    val action = if (direction == "up") {
      AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    } else {
      AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
    }
    return scrollable.performAction(action)
  }

  /**
   * Scroll until `until` is found on screen, or up to `maxPasses` scrolls.
   * Scrolls the `container` if given (or its nearest scrollable), otherwise
   * the first scrollable view under the root. Returns true once found.
   */
  fun scrollUntilElement(
    until: Sel,
    container: Sel?,
    direction: String,
    maxPasses: Int,
  ): Boolean {
    val action = if (direction == "up") {
      AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
    } else {
      AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
    }
    var pass = 0
    while (true) {
      if (findFirst(rootInActiveWindow, until) != null) return true
      if (pass >= maxPasses) return false
      val scrollable = if (container != null) {
        val node = findFirst(rootInActiveWindow, container)
        if (node != null && node.isScrollable) node else node?.let { findScrollable(it) }
      } else {
        rootInActiveWindow?.let { findScrollable(it) }
      } ?: return false
      if (!scrollable.performAction(action)) return findFirst(rootInActiveWindow, until) != null
      Thread.sleep(SCROLL_SETTLE_MS)
      pass++
    }
  }

  /** Reads an element's text (or content-description). Null if not found. */
  fun readElementText(selector: Sel): String? {
    val node = findFirst(rootInActiveWindow, selector) ?: return null
    return node.text?.toString() ?: node.contentDescription?.toString()
  }

  /** Press the system back button. */
  fun pressBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)

  /** Press the system home button. */
  fun pressHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

  /** Open the recent-apps overview. */
  fun pressRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)

  /** Pull down the notification shade. */
  fun openNotifications(): Boolean = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)

  /** True if any node on the current screen matches the selector. */
  fun exists(selector: Sel): Boolean = findFirst(rootInActiveWindow, selector) != null

  /**
   * Taps `target` within the same "row" as `anchor`. Finds the anchor, then
   * walks up its ancestors; the first ancestor whose subtree also contains the
   * target is the shared row, so we tap that target. False if either is missing.
   */
  fun tapInRow(anchor: Sel, target: Sel): Boolean {
    // Content-driven, not time-driven: poll until a row that contains BOTH the
    // anchor and the target actually exists on screen, then tap the target in
    // that row. We consider ALL anchor matches (not just the first), so a stray
    // match that holds the same text but whose row has no target — e.g. a search
    // box echoing what we typed — is skipped instead of failing the step. The
    // polling lets a filtered list settle before we act, rather than tapping
    // whatever happened to be on screen after a fixed delay.
    val deadline = System.currentTimeMillis() + TAP_IN_ROW_TIMEOUT_MS
    while (true) {
      val anchors = ArrayList<AccessibilityNodeInfo>()
      findAll(rootInActiveWindow, anchor, anchors)
      for (anchorNode in anchors) {
        // Skip editable anchors — e.g. the search box echoing the text we typed.
        // It shares a high ancestor with the whole list, so walking up from it
        // would resolve the target to the FIRST row's control, not the item's.
        // The real list-row name is a plain (non-editable) TextView.
        if (anchorNode.isEditable) continue
        var ancestor: AccessibilityNodeInfo? = anchorNode.parent
        while (ancestor != null) {
          val targetNode = findFirst(ancestor, target)
          if (targetNode != null) return tapNode(targetNode)
          ancestor = ancestor.parent
        }
      }
      if (System.currentTimeMillis() >= deadline) return false
      Thread.sleep(POLL_INTERVAL_MS)
    }
  }

  /** Taps absolute screen coordinates with a short gesture. */
  fun tapAt(x: Double, y: Double): Boolean {
    val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, TAP_DURATION_MS))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  /** Long-presses the matched element's centre (~600ms). False if not found. */
  fun longPress(selector: Sel): Boolean {
    val node = findFirst(rootInActiveWindow, selector) ?: return false
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.isEmpty) return false
    val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, LONG_PRESS_DURATION_MS))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  /** Double-taps the matched element's centre. False if not found. */
  fun doubleTap(selector: Sel): Boolean {
    val node = findFirst(rootInActiveWindow, selector) ?: return false
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.isEmpty) return false
    val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, TAP_DURATION_MS))
      .addStroke(GestureDescription.StrokeDescription(path, DOUBLE_TAP_GAP_MS, TAP_DURATION_MS))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  /**
   * Swipes in a direction starting from the matched element's centre (or the
   * screen centre when no selector is given/found). Distance is ~40% of the
   * relevant screen dimension.
   */
  fun swipe(direction: String, selector: Sel?): Boolean {
    val metrics = resources.displayMetrics
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    val bounds = Rect()
    val node = selector?.let { findFirst(rootInActiveWindow, it) }
    if (node != null) node.getBoundsInScreen(bounds)
    val startX = if (node != null && !bounds.isEmpty) bounds.exactCenterX() else width / 2f
    val startY = if (node != null && !bounds.isEmpty) bounds.exactCenterY() else height / 2f
    val dx = width * SWIPE_FRACTION
    val dy = height * SWIPE_FRACTION
    val (endX, endY) = when (direction) {
      "up" -> startX to (startY - dy)
      "down" -> startX to (startY + dy)
      "left" -> (startX - dx) to startY
      "right" -> (startX + dx) to startY
      else -> return false
    }
    val path = Path().apply {
      moveTo(startX, startY)
      lineTo(endX, endY)
    }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, SWIPE_DURATION_MS))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  /** Sets the matched editable node's text. False if not found. */
  fun setText(selector: Sel, text: String): Boolean {
    val node = findFirst(rootInActiveWindow, selector) ?: return false
    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
  }

  /** Clears the matched editable node's text. False if not found. */
  fun clearText(selector: Sel): Boolean = setText(selector, "")

  /**
   * Snapshot every visible text-bearing node on the current screen.
   * Result is a map of { package, texts: [..], nodes: [{ text, contentDesc, viewId, clickable }] }
   * — ready to be serialised straight to JSON for the JS side.
   */
  fun readScreen(): Map<String, Any?> {
    val root = rootInActiveWindow
    val texts = mutableListOf<String>()
    val nodes = mutableListOf<Map<String, Any?>>()
    if (root != null) collectScreen(root, texts, nodes)
    return mapOf(
      "package" to root?.packageName?.toString(),
      "texts" to texts,
      "nodes" to nodes,
    )
  }

  private fun collectScreen(
    node: AccessibilityNodeInfo,
    texts: MutableList<String>,
    nodes: MutableList<Map<String, Any?>>,
  ) {
    val text = node.text?.toString()?.takeIf { it.isNotBlank() }
    val cd = node.contentDescription?.toString()?.takeIf { it.isNotBlank() }
    val viewId = node.viewIdResourceName
    // Include any node with text/desc, OR an id, OR that is clickable — so
    // icon buttons and switches with no label (e.g. a row's on/off toggle or a
    // hamburger) still appear in the dump and can be targeted by viewId.
    if (text != null || cd != null || viewId != null || node.isClickable) {
      // Feed text into `texts` (what sendRequest/raw_text uses). Some apps put
      // the whole order in contentDescription rather than text (e.g. Yammak), so
      // fall back to the description when there's no text — otherwise the
      // captured order would be empty.
      if (text != null) texts.add(text)
      else if (cd != null) texts.add(cd)
      val b = Rect()
      node.getBoundsInScreen(b)
      nodes.add(
        mapOf(
          "text" to text,
          "contentDesc" to cd,
          "viewId" to viewId,
          "clickable" to node.isClickable,
          "left" to b.left,
          "top" to b.top,
          "right" to b.right,
          "bottom" to b.bottom,
        )
      )
    }
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      collectScreen(child, texts, nodes)
    }
  }

  /**
   * Read the full scrollable content by accumulating every viewport's text from
   * the current position downward — so long order screens whose items don't all
   * fit on one screen are captured whole (a plain readScreen after scrolling to
   * the bottom only sees the last viewport). Stops when `until` appears, when a
   * scroll makes no change (reached the bottom), or after `maxPasses`.
   * Overlapping duplicates are left in — the server-side parser de-duplicates
   * by item, and needs the repeats to keep distinct same-named lines.
   */
  fun readScreenScrolling(until: Sel?, maxPasses: Int): Map<String, Any?> {
    // Capture from the CURRENT position downward. The order detail opens at the
    // top (header with the order #), so we do NOT rewind — rewinding wastes
    // passes (ACTION_SCROLL_BACKWARD reports success even at the top) and can
    // collapse/navigate the detail. Hard caps on passes AND wall-clock time
    // guarantee this can never hang, regardless of how the list reports itself.
    val texts = mutableListOf<String>()
    val scratch = mutableListOf<Map<String, Any?>>()  // node sink, discarded
    val deadline = System.currentTimeMillis() + READ_SCROLL_MAX_MS
    val passes = maxPasses.coerceIn(1, 12)
    val pkg = rootInActiveWindow?.packageName?.toString()
    var pass = 0
    while (true) {
      val cur = mutableListOf<String>()
      scratch.clear()
      rootInActiveWindow?.let { collectScreen(it, cur, scratch) }
      val added = appendStitched(texts, cur)
      // Stop on `until` — check the text we just collected (no extra tree walk).
      if (until != null && cur.any { matchesText(it, until) }) break
      if (pass > 0 && added <= 1) break                 // nothing new → at bottom
      if (pass >= passes) break
      if (System.currentTimeMillis() >= deadline) break  // wall-clock safety wall
      val scrollable = rootInActiveWindow?.let { findScrollable(it) } ?: break
      if (!scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) break
      Thread.sleep(SCROLL_SETTLE_MS)
      pass++
    }
    return mapOf(
      "package" to pkg,
      "texts" to texts,
      "nodes" to emptyList<Any?>(),  // raw_text uses texts only; omit heavy nodes
    )
  }

  /** True if a node's own text/desc satisfies a text/contains selector — used to
   *  test the stop condition against already-collected strings (no tree walk). */
  private fun matchesText(value: String, sel: Sel): Boolean = when (sel.strategy) {
    "text" -> if (sel.match == "contains") value.contains(sel.value) else value == sel.value
    else -> false
  }

  /** Append `seg` to `acc`, skipping the longest suffix-of-acc / prefix-of-seg
   *  overlap (so consecutive scroll viewports stitch without duplication).
   *  Returns the number of newly appended lines. */
  private fun appendStitched(acc: MutableList<String>, seg: List<String>): Int {
    if (seg.isEmpty()) return 0
    if (acc.isEmpty()) { acc.addAll(seg); return seg.size }
    val maxK = minOf(acc.size, seg.size)
    var overlap = 0
    for (k in maxK downTo 1) {
      var match = true
      for (j in 0 until k) {
        if (acc[acc.size - k + j] != seg[j]) { match = false; break }
      }
      if (match) { overlap = k; break }
    }
    for (j in overlap until seg.size) acc.add(seg[j])
    return seg.size - overlap
  }

  /**
   * Scrolls a list and reads `fields` off every row, de-duplicating rows that
   * reappear because of scroll overlap.
   */
  fun extractList(
    listSelector: Sel,
    itemSelector: Sel,
    fields: Map<String, Sel>,
    maxScrollPasses: Int,
  ): List<Map<String, String>> {
    val results = mutableListOf<Map<String, String>>()
    val seen = mutableSetOf<String>()

    var pass = 0
    while (true) {
      val list = findFirst(rootInActiveWindow, listSelector)
      if (list != null) {
        val items = mutableListOf<AccessibilityNodeInfo>()
        findAll(list, itemSelector, items)
        for (item in items) {
          val row = LinkedHashMap<String, String>()
          for ((name, fieldSel) in fields) {
            val node = findFirst(item, fieldSel)
            val text = node?.text?.toString() ?: node?.contentDescription?.toString()
            if (!text.isNullOrEmpty()) row[name] = text
          }
          if (row.isEmpty()) continue
          val key = row.entries.joinToString("|") { "${it.key}=${it.value}" }
          if (seen.add(key)) results.add(row)
        }
      }

      if (pass >= maxScrollPasses) break
      if (list == null || !list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) break
      Thread.sleep(SCROLL_SETTLE_MS)
      pass++
    }
    return results
  }

  // ---- tree helpers -------------------------------------------------------

  private fun tapNode(node: AccessibilityNodeInfo): Boolean {
    // Prefer a real click on the node or its nearest clickable ancestor.
    if (node.isClickable && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
    var parent = node.parent
    while (parent != null) {
      if (parent.isClickable && parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
      parent = parent.parent
    }
    // Fall back to a tap gesture at the node's centre.
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    if (bounds.isEmpty) return false
    val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, TAP_DURATION_MS))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  private fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
    if (node.isScrollable) return node
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      val found = findScrollable(child)
      if (found != null) return found
    }
    return null
  }

  private fun findFirst(root: AccessibilityNodeInfo?, selector: Sel): AccessibilityNodeInfo? {
    root ?: return null
    if (nodeMatches(root, selector)) return root
    for (i in 0 until root.childCount) {
      val found = findFirst(root.getChild(i), selector)
      if (found != null) return found
    }
    return null
  }

  private fun findAll(
    root: AccessibilityNodeInfo?,
    selector: Sel,
    out: MutableList<AccessibilityNodeInfo>,
  ) {
    root ?: return
    if (nodeMatches(root, selector)) out.add(root)
    for (i in 0 until root.childCount) {
      findAll(root.getChild(i), selector, out)
    }
  }

  private fun nodeMatches(node: AccessibilityNodeInfo, selector: Sel): Boolean {
    // Package scope guard. When set, this matcher only ever returns true
    // for nodes whose owning app is the target — so the engine ignores its
    // own UI, the launcher, system bars, etc.
    if (selector.packageScope.isNotEmpty()) {
      val nodePackage = node.packageName?.toString()
      if (nodePackage != null && nodePackage != selector.packageScope) return false
    }
    return when (selector.strategy) {
      "package" -> node.packageName?.toString() == selector.value
      "viewId" -> {
        val id = node.viewIdResourceName ?: return false
        id == selector.value || id.substringAfterLast('/') == selector.value
      }
      "text" -> textMatches(node.text?.toString(), selector)
      "contentDesc" -> textMatches(node.contentDescription?.toString(), selector)
      else -> false
    }
  }

  private fun textMatches(text: String?, selector: Sel): Boolean {
    text ?: return false
    return when (selector.match) {
      "contains" -> text.contains(selector.value)
      "regex" -> runCatching { Regex(selector.value).containsMatchIn(text) }.getOrDefault(false)
      else -> text == selector.value
    }
  }

  /** A parsed selector — strategy + value + match mode + optional package scope. */
  data class Sel(
    val strategy: String,
    val value: String,
    val match: String,
    val packageScope: String = "",
  ) {
    companion object {
      fun from(map: Map<String, Any?>): Sel = Sel(
        strategy = map["strategy"] as? String ?: "",
        value = map["value"] as? String ?: "",
        match = map["match"] as? String ?: "exact",
        packageScope = map["packageScope"] as? String ?: "",
      )
    }
  }

  companion object {
    /** The live service instance, or null when it is not connected. */
    @Volatile
    var instance: PrimeAccessibilityService? = null
      private set

    /** Package name of the app currently in the foreground. */
    @Volatile
    var foregroundPackage: String? = null
      private set

    /** True while the service is connected and usable. */
    val isConnected: Boolean
      get() = instance != null

    private const val POLL_INTERVAL_MS = 200L
    private const val SCROLL_SETTLE_MS = 600L
    /** Hard wall-clock cap for readScreenScrolling — guarantees no hang. */
    private const val READ_SCROLL_MAX_MS = 8000L
    private const val TAP_IN_ROW_TIMEOUT_MS = 6000L
    private const val TAP_DURATION_MS = 50L
    private const val LONG_PRESS_DURATION_MS = 600L
    private const val DOUBLE_TAP_GAP_MS = 150L
    private const val SWIPE_DURATION_MS = 300L
    private const val SWIPE_FRACTION = 0.4f
  }
}
