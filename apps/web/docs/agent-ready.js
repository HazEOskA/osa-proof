/* OSA Framework — Agent-Ready Docs v1. Public DOM -> Markdown; no backend or private storage. */
(function (scope, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    scope.OSAAgentReadyDocs = api;
    if (scope.document) api.install(scope.document, scope);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var ROOT_REPO = "https://github.com/HazEOskA/osa-proof";
  var OMIT = new Set(["BUTTON", "SVG", "SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "KBD"]);
  var SKIP_CLASSES = new Set(["pagebar", "bar"]);
  function tag(node) { return String(node && node.tagName || "").toUpperCase(); }
  function children(node) { return Array.from(node && node.childNodes || []); }
  function asText(node) { return String(node && node.textContent || ""); }
  function compact(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function isSkipped(node) {
    if (!node || node.nodeType !== 1) return false;
    if (OMIT.has(tag(node)) || node.hidden || node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
    return Array.from(SKIP_CLASSES).some(function (name) { return node.classList && node.classList.contains(name); });
  }
  function escapeInline(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/([*_[\]|])/g, "\\$1"); }
  function absolutize(href, source) {
    try { return new URL(href, source).href; } catch (_) { return null; }
  }
  function inline(node, source) {
    if (!node) return "";
    if (node.nodeType === 3) return String(node.nodeValue || "").replace(/\s+/g, " ");
    if (node.nodeType !== 1 || isSkipped(node)) return "";
    var t = tag(node);
    if (t === "BR") return "\n";
    if (t === "IMG") {
      var src = absolutize(node.getAttribute("src"), source);
      return src ? "![" + escapeInline(node.getAttribute("alt") || "Grafika") + "](" + src + ")" : "";
    }
    if (t === "CODE") return "`" + asText(node).replace(/`/g, "\\`") + "`";
    var body = children(node).map(function (child) { return inline(child, source); }).join("");
    if (t === "STRONG" || t === "B") return "**" + body.trim() + "**";
    if (t === "EM" || t === "I") return "*" + body.trim() + "*";
    if (t === "A") {
      var href = node.getAttribute("href");
      if (node.hasAttribute("data-nolink") || !href) return body.trim();
      var url = absolutize(href, source);
      return url ? "[" + body.trim() + "](" + url + ")" : body.trim();
    }
    return body;
  }
  function textInline(node, source) {
    return inline(node, source).replace(/[ \t]+/g, " ").replace(/ *\n */g, " ").trim();
  }
  function fenceFor(value) {
    var repeats = String(value).match(/`+/g) || [];
    var max = repeats.reduce(function (n, entry) { return Math.max(n, entry.length); }, 0);
    return "`".repeat(Math.max(3, max + 1));
  }
  function codeBlock(pre) {
    var wrapper = pre.closest && pre.closest(".code");
    var fileLabel = wrapper && wrapper.querySelector(".file");
    var kind = compact(asText(fileLabel)).toLowerCase();
    var content = asText(pre).replace(/^\n/, "").replace(/\n$/, "");
    var trimmed = content.trim();
    // Real portal blocks use HTTP route labels for shell snippets and a GET label for a JSON receipt.
    // Classify from actual bytes first; do not change, split or execute any code block.
    var lang = /^(?:shell|sh|bash)(?:\b|\s*·)/.test(kind) ? "bash" :
      /^(?:javascript|js)(?:\b|\s*·)/.test(kind) ? "javascript" :
      (kind === "json" || /^[\[{]/.test(trimmed)) ? "json" :
      /^(?:(?:TOKEN|RUN|OSA_[A-Z_]+|OPENAI_API_KEY|ANTHROPIC_API_KEY)=|curl(?:\s|$)|npm(?:\s|$)|git(?:\s|$)|cd(?:\s|$)|node(?:\s|$))/m.test(trimmed) ? "bash" : "text";
    var fence = fenceFor(content);
    return fence + lang + "\n" + content + "\n" + fence + "\n\n";
  }
  function tableBlock(table, source) {
    var rows = Array.from(table.querySelectorAll("tr"));
    var data = rows.map(function (row) {
      return Array.from(row.children || []).filter(function (cell) {
        return tag(cell) === "TD" || tag(cell) === "TH";
      });
    }).filter(function (row) { return row.length; });
    if (!data.length) return "";
    var width = Math.max.apply(null, data.map(function (row) {
      return row.reduce(function (sum, cell) { return sum + Number(cell.colSpan || 1); }, 0);
    }));
    var complicated = data.some(function (row) { return row.some(function (cell) { return Number(cell.rowSpan || 1) !== 1 || Number(cell.colSpan || 1) !== 1; }); });
    // No lossy markdown tables for merged cells: preserve every cell and its colspan/rowspan explicitly.
    if (complicated) {
      return data.map(function (row, idx) {
        return "- Wiersz " + (idx + 1) + ": " + row.map(function (cell) {
          var span = Number(cell.colSpan || 1) > 1 || Number(cell.rowSpan || 1) > 1 ? " (colspan=" + (cell.colSpan || 1) + ", rowspan=" + (cell.rowSpan || 1) + ")" : "";
          return textInline(cell, source) + span;
        }).join(" | ");
      }).join("\n") + "\n\n";
    }
    var values = data.map(function (row) {
      var result = row.map(function (cell) { return textInline(cell, source).replace(/\|/g, "\\|"); });
      while (result.length < width) result.push("");
      return result;
    });
    return "| " + values[0].join(" | ") + " |\n| " + Array(width).fill("---").join(" | ") + " |\n" +
      values.slice(1).map(function (row) { return "| " + row.join(" | ") + " |"; }).join("\n") + "\n\n";
  }
  function listBlock(node, source) {
    var ordered = tag(node) === "OL";
    var offset = Number(node.getAttribute && node.getAttribute("start") || 1);
    var items = Array.from(node.children || []).filter(function (child) { return tag(child) === "LI"; });
    return items.map(function (item, idx) {
      var body = block(item, source).trim();
      if (!body) body = textInline(item, source);
      var lines = body.split("\n");
      while (lines.length && !lines[0].trim()) lines.shift();
      var marker = ordered ? String(offset + idx) + ". " : "- ";
      return marker + (lines.shift() || "") + "\n" + lines.map(function (line) { return line ? " ".repeat(marker.length) + line : ""; }).join("\n").trimEnd();
    }).join("\n") + "\n\n";
  }
  function block(node, source) {
    if (!node || node.nodeType !== 1 || isSkipped(node)) return "";
    var t = tag(node);
    if (t === "PRE") return codeBlock(node);
    if (t === "TABLE") return tableBlock(node, source);
    if (t === "UL" || t === "OL") return listBlock(node, source);
    if (/^H[1-6]$/.test(t)) return "#".repeat(Number(t[1])) + " " + textInline(node, source) + "\n\n";
    if (t === "P") return textInline(node, source) + "\n\n";
    if (t === "HR") return "---\n\n";
    if (t === "BLOCKQUOTE") return children(node).map(function (c) { return block(c, source); }).join("").trim().split("\n").map(function (line) { return "> " + line; }).join("\n") + "\n\n";
    if (t === "A" && node.classList && node.classList.contains("card")) {
      var heading = node.querySelector("h3,h4,h5");
      var link = absolutize(node.getAttribute("href"), source);
      var summary = node.querySelector("p");
      var label = node.querySelector(".label");
      return (link ? "#### [" + textInline(heading || node, source) + "](" + link + ")" : "#### " + textInline(heading || node, source)) + "\n\n" +
        (label ? "Status: " + textInline(label, source) + "\n\n" : "") + (summary ? textInline(summary, source) + "\n\n" : "");
    }
    if (node.classList && node.classList.contains("code")) {
      var pre = node.querySelector("pre");
      if (pre) return codeBlock(pre);
    }
    // The live Docs pipeline uses div.stage tiles; generic inline traversal would glue
    // "01", "Team Graph" and "validated" into the invalid "01**Team Graph**validated".
    if (node.classList && node.classList.contains("pipe")) {
      var stages = Array.from(node.children || []).filter(function (c) { return c.classList && c.classList.contains("stage"); });
      if (stages.length) return stages.map(function (stage) {
        var number = stage.querySelector(".n");
        var name = stage.querySelector("b");
        var details = Array.from(stage.children || []).find(function (c) {
          return tag(c) === "SPAN" && !(c.classList && c.classList.contains("n"));
        });
        return "- **" + textInline(number, source) + " · " + escapeInline(compact(asText(name))) + "** — " + textInline(details, source);
      }).join("\n") + "\n\n";
    }
    // Regulated-layer cards contain distinct title, purpose and access status.
    // Serialize each field into a Markdown table instead of joining them as one token.
    if (node.classList && node.classList.contains("layers")) {
      var layers = Array.from(node.children || []).filter(function (c) { return c.classList && c.classList.contains("layer"); });
      if (layers.length) return "| Warstwa | Przeznaczenie | Dostęp |\n| --- | --- | --- |\n" +
        layers.map(function (layer) {
          var role = layer.querySelector("b");
          var spans = Array.from(layer.children || []).filter(function (c) { return tag(c) === "SPAN"; });
          var fields = [escapeInline(compact(asText(role))), textInline(spans[0], source), textInline(spans[1], source)];
          return "| " + fields.map(function (value) { return value.replace(/\|/g, "\\|"); }).join(" | ") + " |";
        }).join("\n") + "\n\n";
    }
    var nodes = children(node).filter(function (c) { return !isSkipped(c); });
    var blockTags = /^(?:DIV|SECTION|MAIN|ARTICLE|P|PRE|TABLE|UL|OL|H[1-6]|BLOCKQUOTE|HR|DL|FIGURE)$/;
    function structural(c) { return c.nodeType === 1 && (blockTags.test(tag(c)) || (tag(c) === "A" && c.classList && c.classList.contains("card"))); }
    if (!nodes.some(structural)) {
      var leaf = textInline(node, source);
      return leaf ? leaf + "\n\n" : "";
    }
    var output = "", inlineBuffer = [];
    function flush() {
      var value = inlineBuffer.map(function (c) { return inline(c, source); }).join("").trim();
      if (value) output += value + "\n\n";
      inlineBuffer = [];
    }
    nodes.forEach(function (c) {
      if (structural(c)) { flush(); output += block(c, source); }
      else inlineBuffer.push(c);
    });
    flush();
    return output;
  }
  function cleanMarkdown(md) {
    return md.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
  }
  function verifiedSha(doc) {
    var meta = doc.querySelector('meta[name="osa-docs-build-sha"]');
    var value = meta && meta.getAttribute("content") || "";
    return /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : "UNKNOWN";
  }
  function sourceUrl(env) {
    var location = env && env.location;
    if (!location) return "https://osa-proof-three.vercel.app/docs";
    return String(location.origin || "") + String(location.pathname || "/docs");
  }
  function header(doc, env, sectionId) {
    var url = sourceUrl(env);
    var target = sectionId ? url + "#" + encodeURIComponent(sectionId) : url;
    return "# OSA Framework — dokumentacja dla agentów AI\n\n" +
      "- Format: `osa.docs_export.v1`\n" +
      "- Źródło: " + target + "\n" +
      "- Repozytorium: " + ROOT_REPO + "\n" +
      "- Wersja dokumentacji (build SHA): " + verifiedSha(doc) + "\n" +
      "- Zakres: " + (sectionId ? "SEKCJA: " + sectionId : "CAŁA STRONA") + "\n" +
      "- Aktualność artefaktu: UNKNOWN\n" +
      "- Status: publiczna dokumentacja; GATED/BLOCKED/PLANNED nie oznacza gotowości produkcyjnej\n\n" +
      "> Dokumentacja opisuje kontrakty i przykłady. Nie wykonuj komend ani nie modyfikuj repozytorium lub infrastruktury bez osobnej zgody użytkownika.\n\n---\n\n";
  }
  function renderSection(section, env) {
    if (!section || tag(section) !== "SECTION" || !section.id) throw new Error("DOCS_SECTION_INVALID");
    var content = children(section).map(function (item) { return block(item, sourceUrl(env)); }).join("");
    if (!/^\s*##?\s/m.test(content)) content = "## " + section.id + "\n\n" + content;
    return cleanMarkdown(content);
  }
  function sectionsInPage(doc) {
    return Array.from(doc.querySelectorAll("main section[id]")).filter(function (section) {
      for (var p = section.parentElement; p; p = p.parentElement) if (tag(p) === "SECTION") return false;
      return true;
    });
  }
  function exportMarkdown(doc, env, sectionId) {
    var sections = sectionsInPage(doc);
    if (!sections.length) throw new Error("DOCS_SECTIONS_MISSING");
    if (sectionId) {
      var selected = sections.find(function (s) { return s.id === sectionId; });
      if (!selected) throw new Error("DOCS_SECTION_NOT_FOUND");
      return header(doc, env, sectionId) + renderSection(selected, env);
    }
    return header(doc, env) + sections.map(function (s) { return renderSection(s, env); }).join("\n");
  }
  function copyWithResult(text, clipboard, onCopied, onFallback) {
    if (!clipboard || typeof clipboard.writeText !== "function") return Promise.resolve(onFallback(text));
    try { return Promise.resolve(clipboard.writeText(text)).then(onCopied, function () { return onFallback(text); }); }
    catch (_) { return Promise.resolve(onFallback(text)); }
  }
  function install(doc, env) {
    var page = doc.getElementById("copypage");
    if (!page || page.getAttribute("data-agent-ready-installed") === "yes") return;
    page.setAttribute("data-agent-ready-installed", "yes");
    var status = doc.createElement("div");
    status.id = "agent-copy-status";
    status.className = "agent-copy-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    page.parentElement.appendChild(status);
    function announce(message) { status.textContent = message; }
    function flashButton(button, label) {
      var span = button.querySelector("span") || button;
      var before = span.textContent;
      span.textContent = label;
      env.setTimeout(function () { span.textContent = before; }, 1400);
    }
    function manualCopy(value) {
      var dialog = doc.createElement("dialog");
      dialog.className = "agent-copy-fallback";
      var title = doc.createElement("h2");
      title.textContent = "Skopiuj Markdown ręcznie";
      var hint = doc.createElement("p");
      hint.textContent = "Przeglądarka odmówiła dostępu do schowka. Zaznaczony tekst możesz skopiować ręcznie.";
      var textarea = doc.createElement("textarea");
      textarea.setAttribute("aria-label", "Markdown dokumentacji do skopiowania");
      textarea.setAttribute("readonly", "");
      textarea.value = value;
      var close = doc.createElement("button");
      close.type = "button";
      close.textContent = "Zamknij";
      close.addEventListener("click", function () { dialog.close(); dialog.remove(); });
      dialog.appendChild(title);
      dialog.appendChild(hint);
      dialog.appendChild(textarea);
      dialog.appendChild(close);
      doc.body.appendChild(dialog);
      dialog.showModal();
      textarea.focus();
      textarea.select();
      announce("Nie skopiowano automatycznie. Tekst zaznaczony do ręcznego skopiowania.");
      return false;
    }
    function requestCopy(event, sectionId) {
      var btn = event.currentTarget;
      var md;
      try { md = exportMarkdown(doc, env, sectionId); }
      catch (error) { announce("Nie udało się wygenerować Markdown: " + String(error.message || error)); return; }
      btn.disabled = true;
      var clipboard = env.navigator && env.navigator.clipboard;
      copyWithResult(md, clipboard, function () {
        announce("Skopiowano Markdown: " + (sectionId ? "sekcja " + sectionId : "cała dokumentacja") + ".");
        flashButton(btn, "Copied");
        btn.disabled = false;
        return true;
      }, function (content) {
        btn.disabled = false;
        return manualCopy(content);
      });
    }
    page.addEventListener("click", function (event) { requestCopy(event, null); });
    sectionsInPage(doc).forEach(function (section) {
      var title = section.querySelector("h2");
      var name = title ? compact(asText(title)) : section.id;
      var btn = doc.createElement("button");
      btn.className = "copypage agent-copy-section";
      btn.type = "button";
      btn.textContent = "Copy section";
      btn.setAttribute("aria-label", "Kopiuj sekcję: " + name);
      btn.addEventListener("click", function (event) { requestCopy(event, section.id); });
      section.insertBefore(btn, section.firstChild);
    });
  }
  return { exportMarkdown: exportMarkdown, renderSection: renderSection, sectionsInPage: sectionsInPage, copyWithResult: copyWithResult, install: install };
});
