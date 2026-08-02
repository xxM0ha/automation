"""Parse ``uiautomator dump`` XML and match automation selectors against it.

This is the ADB-port equivalent of the Kotlin selector matching in
``PrimeAccessibilityService.kt`` (see ``nodeMatches``, ``textMatches``,
``findFirst``, ``findAll`` and ``tapInRow``). On the accessibility-service
side we walk a live ``AccessibilityNodeInfo`` tree; here we walk the static
XML tree produced by ``adb shell uiautomator dump``. The matching semantics
are replicated exactly so a config that works through the on-device service
behaves identically when driven over ADB.

Standard library only.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Selector
# ---------------------------------------------------------------------------


@dataclass
class Selector:
    """A parsed selector: strategy + value + match mode + optional package scope.

    Mirrors the Kotlin ``Sel`` data class. ``package_scope``, when non-empty,
    restricts matching to nodes whose package equals it (the engine ignoring
    its own UI, the launcher, system bars, etc.).
    """

    strategy: str
    value: str
    match: str = "exact"
    package_scope: str = ""  # when set, only match nodes whose package == this


def selector_from_dict(d: dict) -> "Selector":
    """Build a :class:`Selector` from a config dict.

    Tolerates a missing ``match`` (defaults to ``"exact"``) and reads the
    optional ``packageScope`` key, mirroring ``Sel.from`` in Kotlin.
    """
    return Selector(
        strategy=d.get("strategy", "") or "",
        value=d.get("value", "") or "",
        match=d.get("match", "exact") or "exact",
        package_scope=d.get("packageScope", "") or "",
    )


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@dataclass
class Node:
    """A single ``<node>`` from the uiautomator dump.

    Field names map onto the XML attributes (``resource-id`` -> ``resource_id``,
    ``content-desc`` -> ``content_desc``, ``class`` -> ``clazz``). ``editable``
    is derived from the class name, since uiautomator XML has no dedicated
    editable flag but ``find_in_row`` needs to skip EditText search boxes.
    """

    resource_id: str  # full, e.g. "com.x:id/btn"
    text: str
    content_desc: str
    clazz: str  # the "class" attr
    package: str
    clickable: bool
    enabled: bool
    editable: bool  # True if class contains "EditText" (skip search boxes in find_in_row)
    bounds: Tuple[int, int, int, int]  # (left, top, right, bottom)

    @property
    def center(self) -> Tuple[int, int]:
        """The (cx, cy) midpoint of ``bounds`` as ints."""
        left, top, right, bottom = self.bounds
        return ((left + right) // 2, (top + bottom) // 2)


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def _text_matches(text: str, sel: "Selector") -> bool:
    """Compare ``text`` against ``sel.value`` per the selector's match mode.

    Replicates Kotlin ``textMatches``: ``contains`` -> substring, ``regex`` ->
    ``re.search`` (guarded; bad patterns return False), anything else ->
    equality. In the live service a null text fails to match; here a node's
    text/content-desc is "" when absent, which the equality/substring checks
    handle naturally.
    """
    if sel.match == "contains":
        return sel.value in text
    if sel.match == "regex":
        try:
            return re.search(sel.value, text) is not None
        except re.error:
            return False
    return text == sel.value


def matches(node: "Node", sel: "Selector") -> bool:
    """True if ``node`` satisfies ``sel``. Replicates Kotlin ``nodeMatches``.

    The ``package_scope`` guard runs before the strategy check: when set, a
    node only matches if its package equals the scope.
    """
    # Package scope guard. When set, only nodes from the target app match.
    if sel.package_scope:
        if node.package and node.package != sel.package_scope:
            return False

    if sel.strategy == "package":
        return node.package == sel.value
    if sel.strategy == "viewId":
        rid = node.resource_id
        if not rid:
            return False
        return rid == sel.value or rid.rsplit("/", 1)[-1] == sel.value
    if sel.strategy == "text":
        return _text_matches(node.text, sel)
    if sel.strategy == "contentDesc":
        return _text_matches(node.content_desc, sel)
    return False


# ---------------------------------------------------------------------------
# Hierarchy
# ---------------------------------------------------------------------------


def _attr(el: ET.Element, name: str) -> str:
    """Read an XML attribute, treating a missing attr as the empty string."""
    return el.get(name, "") or ""


def _parse_bounds(raw: str) -> Tuple[int, int, int, int]:
    """Parse a uiautomator bounds string ``"[l,t][r,b]"`` to a 4-int tuple.

    Returns ``(0, 0, 0, 0)`` when the string is missing or malformed.
    """
    nums = re.findall(r"-?\d+", raw)
    if len(nums) >= 4:
        return (int(nums[0]), int(nums[1]), int(nums[2]), int(nums[3]))
    return (0, 0, 0, 0)


def _element_to_node(el: ET.Element) -> "Node":
    """Convert a ``<node>`` element into a :class:`Node`."""
    clazz = _attr(el, "class")
    return Node(
        resource_id=_attr(el, "resource-id"),
        text=_attr(el, "text"),
        content_desc=_attr(el, "content-desc"),
        clazz=clazz,
        package=_attr(el, "package"),
        clickable=_attr(el, "clickable") == "true",
        enabled=_attr(el, "enabled") == "true",
        editable="EditText" in clazz,
        bounds=_parse_bounds(_attr(el, "bounds")),
    )


@dataclass
class Hierarchy:
    """A parsed uiautomator tree with selector-matching queries.

    Holds the list of ``<node>`` elements in DFS order, a cache of converted
    :class:`Node` objects, and a parent map (ElementTree has no parent
    pointers) so :meth:`find_in_row` can walk ancestors.
    """

    _elements: List[ET.Element] = field(default_factory=list)
    _node_of: Dict[ET.Element, "Node"] = field(default_factory=dict)
    _parent_of: Dict[ET.Element, Optional[ET.Element]] = field(default_factory=dict)

    @classmethod
    def parse(cls, xml: str) -> "Hierarchy":
        """Parse a uiautomator dump XML string into a :class:`Hierarchy`.

        Builds, in a single DFS, the ordered element list, the element->Node
        cache and the parent map.
        """
        root = ET.fromstring(xml)
        elements: List[ET.Element] = []
        node_of: Dict[ET.Element, "Node"] = {}
        parent_of: Dict[ET.Element, Optional[ET.Element]] = {}

        # DFS over <node> elements only. The document root may itself be a
        # <hierarchy> wrapper rather than a <node>; include any node tags.
        def walk(el: ET.Element, parent: Optional[ET.Element]) -> None:
            if el.tag == "node":
                elements.append(el)
                node_of[el] = _element_to_node(el)
                parent_of[el] = parent
                child_parent: Optional[ET.Element] = el
            else:
                # Non-<node> wrapper (e.g. <hierarchy>): don't break the chain,
                # children's effective parent stays whatever we were handed.
                child_parent = parent
            for child in el:
                walk(child, child_parent)

        walk(root, None)
        return cls(_elements=elements, _node_of=node_of, _parent_of=parent_of)

    # -- queries ------------------------------------------------------------

    def find(self, sel: "Selector") -> Optional["Node"]:
        """Return the first node matching ``sel`` in DFS order, or None."""
        for el in self._elements:
            node = self._node_of[el]
            if matches(node, sel):
                return node
        return None

    def find_all(self, sel: "Selector") -> List["Node"]:
        """Return all nodes matching ``sel`` in DFS order."""
        return [self._node_of[el] for el in self._elements if matches(self._node_of[el], sel)]

    def _subtree_find(self, root_el: ET.Element, sel: "Selector") -> Optional["Node"]:
        """First match for ``sel`` within ``root_el``'s subtree (inclusive), DFS."""
        stack = [root_el]
        while stack:
            el = stack.pop()
            node = self._node_of.get(el)
            if node is not None and matches(node, sel):
                return node
            # Push children reversed so they are visited left-to-right (DFS).
            children = [c for c in el if c.tag == "node"]
            stack.extend(reversed(children))
        return None

    def find_in_row(self, anchor: "Selector", target: "Selector") -> Optional["Node"]:
        """Find ``target`` in the same "row" as ``anchor``.

        Replicates the FIXED Kotlin ``tapInRow``: consider ALL anchor matches,
        skip any whose node is editable (an EditText search box echoing typed
        text), and for each remaining anchor walk UP its ancestors. The first
        ancestor whose subtree contains a ``target`` match yields that target
        node. Returns None if no row contains both.
        """
        for el in self._elements:
            anchor_node = self._node_of[el]
            if not matches(anchor_node, anchor):
                continue
            # Skip editable anchors (e.g. the search box echoing typed text):
            # they share a high ancestor with the whole list, so walking up
            # would resolve the target to the first row's control.
            if anchor_node.editable:
                continue
            ancestor = self._parent_of.get(el)
            while ancestor is not None:
                found = self._subtree_find(ancestor, target)
                if found is not None:
                    return found
                ancestor = self._parent_of.get(ancestor)
        return None

    def texts(self) -> List[str]:
        """Text-bearing strings for readScreen: text if non-blank, else content-desc.

        DFS order, mirroring Kotlin ``collectScreen``: a node contributes its
        text when non-blank, otherwise its content-desc when non-blank; nodes
        with neither contribute nothing.
        """
        out: List[str] = []
        for el in self._elements:
            node = self._node_of[el]
            if node.text.strip():
                out.append(node.text)
            elif node.content_desc.strip():
                out.append(node.content_desc)
        return out


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sample = (
        '<hierarchy rotation="0">'
        '  <node class="android.widget.LinearLayout" package="com.x" bounds="[0,0][1080,200]">'
        '    <node resource-id="com.x:id/label" text="Pizza" class="android.widget.TextView"'
        '          package="com.x" clickable="false" enabled="true" bounds="[10,10][300,90]" />'
        '    <node resource-id="com.x:id/switchCompat" class="android.widget.Switch"'
        '          content-desc="toggle" package="com.x" clickable="true" enabled="true"'
        '          bounds="[900,10][1070,90]" />'
        '  </node>'
        '  <node resource-id="com.x:id/search" text="Pizza" class="android.widget.EditText"'
        '        package="com.x" clickable="true" enabled="true" bounds="[0,210][1080,300]" />'
        '</hierarchy>'
    )

    h = Hierarchy.parse(sample)

    # find: short viewId should match the full resource-id.
    sw = h.find(selector_from_dict({"strategy": "viewId", "value": "switchCompat"}))
    assert sw is not None, "find by short viewId failed"
    assert sw.resource_id == "com.x:id/switchCompat"
    assert sw.center == ((900 + 1070) // 2, (10 + 90) // 2)
    print("find ok:", sw.resource_id, sw.center)

    # find by text matches the TextView label (DFS finds it before the EditText).
    label = h.find(selector_from_dict({"strategy": "text", "value": "Pizza"}))
    assert label is not None and label.resource_id == "com.x:id/label"
    print("find text ok:", label.resource_id)

    # find_in_row: anchor on the "Pizza" label, target the switch in its row.
    # The EditText also has text "Pizza" but must be skipped (editable).
    anchor = selector_from_dict({"strategy": "text", "value": "Pizza"})
    target = selector_from_dict({"strategy": "viewId", "value": "switchCompat"})
    row_target = h.find_in_row(anchor, target)
    assert row_target is not None, "find_in_row failed"
    assert row_target.resource_id == "com.x:id/switchCompat"
    print("find_in_row ok:", row_target.resource_id)

    # find_in_row returns None when no row holds both.
    none_target = h.find_in_row(anchor, selector_from_dict({"strategy": "viewId", "value": "nope"}))
    assert none_target is None
    print("find_in_row none ok")

    # texts: text when present, content-desc as fallback (the switch).
    ts = h.texts()
    assert ts == ["Pizza", "toggle", "Pizza"], ts
    print("texts ok:", ts)

    # regex / contains / package-scope sanity.
    assert h.find(selector_from_dict({"strategy": "text", "value": "Piz", "match": "contains"})) is not None
    assert h.find(selector_from_dict({"strategy": "text", "value": "P.zza", "match": "regex"})) is not None
    assert h.find(selector_from_dict({"strategy": "text", "value": "(", "match": "regex"})) is None
    scoped = selector_from_dict({"strategy": "text", "value": "Pizza", "packageScope": "other.app"})
    assert h.find(scoped) is None
    print("match modes ok")

    print("ALL SELF-TESTS PASSED")
