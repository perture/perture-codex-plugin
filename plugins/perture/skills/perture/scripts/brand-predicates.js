// Serializable, read-only browser evaluator. Only the typed compiler output is
// accepted; authored prose and arbitrary selectors are never executed.
function evaluateBrandPredicates({ predicates }) {
  const visible = (element) => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
  const selector = (reference) => {
    const fixed = { title: "h1,h2,h3,[data-perture-role=title]", body: "p,[data-perture-role=body]", caption: "small,figcaption,[data-perture-role=caption]", icon: "svg,[data-perture-role=icon]", buttons: "button,[role=button]", fields: "input,select,textarea", cards: "[data-perture-radius-type=cards]", dialogs: "dialog,[role=dialog]", images: "img", chips: "[data-perture-radius-type=chips]", containers: "[data-perture-radius-type=containers]" };
    if (fixed[reference]) return fixed[reference];
    const pair = String(reference).split(":");
    const attributes = { component: "data-perture-component-id", logo: "data-asset-id", image: "data-asset-id", icon: "data-perture-icon-id", custom: "data-perture-radius-type" };
    return attributes[pair[0]] && pair.length > 1 ? `[${attributes[pair[0]]}="${CSS.escape(pair.slice(1).join(":"))}"]` : null;
  };
  const elementsFor = (reference) => { const query = selector(reference); return query ? [...document.querySelectorAll(query)].filter(visible) : null; };
  return predicates.map((predicate) => {
    let values = [], applicable = false, supported = true;
    if (predicate.kind === "no-horizontal-overflow") { applicable = true; values = [Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)]; }
    else if (["accessible-name", "forbid-element"].includes(predicate.kind)) {
      if (!["button", "input", "img", "video", "nav", "aside"].includes(predicate.element)) supported = false;
      else {
        const elements = [...document.querySelectorAll(predicate.element)].filter(visible).filter((element) => predicate.kind !== "accessible-name" || element.getAttribute("aria-hidden") !== "true" && !(element.tagName === "IMG" && element.getAttribute("alt") === ""));
        applicable = elements.length > 0;
        if (predicate.kind === "forbid-element") { applicable = true; values = [elements.length]; }
        else values = elements.map((element) => {
          const labelled = (element.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
          const name = element.getAttribute("aria-label") || labelled.trim() || (element.tagName === "IMG" ? element.getAttribute("alt") : [...(element.labels || [])].map((label) => label.textContent).join(" ") || element.textContent);
          return name?.trim() ? 0 : 1;
        });
      }
    } else if (predicate.kind === "radius") {
      const elements = elementsFor(predicate.target);
      if (!elements) supported = false;
      else { applicable = elements.length > 0; values = elements.flatMap((element) => { const style = getComputedStyle(element); return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].flatMap((value) => value.split(/\s+/).map((part) => { if (!/^-?\d+(?:\.\d+)?px$/.test(part)) supported = false; return Math.abs(parseFloat(part) - predicate.expected); })); }); }
    } else if (predicate.kind === "spacing") {
      const from = elementsFor(predicate.from), to = elementsFor(predicate.to);
      if (!from || !to) supported = false;
      else {
        const sameReference = predicate.from === predicate.to;
        applicable = sameReference ? from.length > 1 : from.length > 0 && to.length > 0;
        for (const first of from) {
          const second = first.nextElementSibling;
          if (!second || !to.includes(second)) {
            // The final item in a repeated sibling sequence has no next gap.
            const laterMatch = to.some((element) => element !== first && element.parentElement === first.parentElement && Boolean(first.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
            if (applicable && (!sameReference || laterMatch)) supported = false;
            continue;
          }
          const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
          const gap = predicate.direction === "right" ? b.left - a.right : predicate.direction === "left" ? a.left - b.right : predicate.direction === "up" ? a.top - b.bottom : b.top - a.bottom;
          values.push(Math.abs(gap - predicate.expected));
        }
        if (applicable && !values.length) supported = false;
      }
    } else supported = false;
    const violated = values.some((value) => !Number.isFinite(value) || value > 0.75);
    return { id: predicate.id, object_id: predicate.object_id, severity: predicate.severity || "error", status: !supported ? "unverified" : !applicable ? "not_applicable" : violated ? "violated" : "passed", samples: values.length };
  });
}
module.exports = { evaluateBrandPredicates };
