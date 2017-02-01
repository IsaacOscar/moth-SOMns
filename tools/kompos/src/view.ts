/* jshint -W097 */
"use strict";

import {Controller} from "./controller";
import {Source, Method, IdMap, StackFrame, SourceCoordinate, StackTraceResponse,
  TaggedSourceCoordinate, Scope, getSectionId, Variable} from "./messages";
import {Breakpoint, MessageBreakpoint, LineBreakpoint} from "./breakpoints";

declare var ctrl: Controller;

function splitAndKeepNewlineAsEmptyString(str) {
  let result = new Array();
  let line = new Array();

  for (let i = 0; i < str.length; i++) {
    line.push(str[i]);
    if (str[i] === "\n") {
      line.pop();
      line.push("");
      result.push(line);
      line = new Array();
    }
  }
  return result;
}

function sourceToArray(source: string): string[][] {
  let lines = splitAndKeepNewlineAsEmptyString(source);
  let arr = new Array(lines.length + 1);  // +1 is to work around files not ending in newline

  for (let i in lines) {
    let line = lines[i];
    arr[i] = new Array(line.length);
    for (let j = 0; j < line.length; j += 1) {
      arr[i][j] = line[j];
    }
  }
  arr[lines.length] = [""]; // make sure the +1 line has an array with an empty string
  return arr;
}

function methodDeclIdToString(sectionId: string, idx: number) {
  return "m:" + sectionId + ":" + idx;
}

function methodDeclIdToObj(id: string) {
  let arr = id.split(":");
  return {
    sourceId:    arr[1],
    startLine:   parseInt(arr[2]),
    startColumn: parseInt(arr[3]),
    charLength:  parseInt(arr[4]),
    idx:         arr[5]
  };
}

abstract class SectionMarker {
  public type: any;

  constructor(type: any) {
    this.type = type;
  }

  abstract length(): number;
}

class Begin extends SectionMarker {
  private section: TaggedSourceCoordinate;
  private sectionId?: string;

  constructor(section: TaggedSourceCoordinate, sectionId: string) {
    super(Begin);
    this.sectionId = sectionId;
    this.section = section;
    this.type    = Begin;
  }

  toString() {
    return '<span id="' + this.sectionId + '" class="' + this.section.tags.join(" ") + '">';
  }

  length() {
    return this.section.charLength;
  }
}

class BeginMethodDef extends SectionMarker {
  private method:   Method;
  private sourceId: string;
  private i:        number;
  private defPart:  SourceCoordinate;

  constructor(method: Method, sourceId: string, i: number,
      defPart: SourceCoordinate) {
    super(Begin);
    this.method   = method;
    this.sourceId = sourceId;
    this.i        = i;
    this.defPart  = defPart;
  }

  length() {
    return this.defPart.charLength;
  }

  toString() {
    let tags = "MethodDeclaration",
      id = methodDeclIdToString(
        getSectionId(this.sourceId, this.method.sourceSection), this.i);
    return '<span id="' + id + '" class="' + tags + '">';
  }
}

class End extends SectionMarker {
  private section: SourceCoordinate;
  private len:     number;

constructor(section: SourceCoordinate, length: number) {
    super(End);
    this.section = section;
    this.len     = length;
  }

  toString() {
    return "</span>";
  }

  length() {
    return this.len;
  }
}

class Annotation {
  private char: string;
  private before: SectionMarker[];
  private after:  SectionMarker[];

  constructor(char: string) {
    this.char   = char;
    this.before = [];
    this.after  = [];
  }

  toString() {
    this.before.sort(function (a, b) {
      if (a.type !== b.type) {
        if (a.type === Begin) {
          return -1;
        } else {
          return 1;
        }
      }

      if (a.length() === b.length()) {
        return 0;
      }

      if (a.length() < b.length()) {
        return (a.type === Begin) ? 1 : -1;
      } else {
        return (a.type === Begin) ? -1 : 1;
      }
    });

    let result = this.before.join("");
    result += this.char;
    result += this.after.join("");
    return result;
  }
}

function arrayToString(arr: any[][]) {
  let result = "";

  for (let line of arr) {
    for (let c of line) {
      result += c.toString();
    }
    result += "\n";
  }
  return result;
}

function nodeFromTemplate(tplId: string) {
  const tpl = document.getElementById(tplId),
    result = <Element> tpl.cloneNode(true);
  result.removeAttribute("id");
  return result;
}

function createLineNumbers(cnt: number) {
  let result = "<span class='ln' onclick='ctrl.onToggleLineBreakpoint(1, this);'>1</span>";
  for (let i = 2; i <= cnt; i += 1) {
    result = result + "\n<span class='ln' onclick='ctrl.onToggleLineBreakpoint(" + i + ", this);'>" + i + "</span>";
  }
  return result;
}

/**
 * Arguments and results are 1-based.
 * Computation is zero-based.
 */
function ensureItIsAnnotation(arr: any[][], line: number, column: number) {
  let l = line - 1,
    c = column - 1;

  if (!(arr[l][c] instanceof Annotation)) {
    console.assert(typeof arr[l][c] === "string");
    arr[l][c] = new Annotation(arr[l][c]);
  }
  return arr[l][c];
}

/**
 * Determine line and column for `length` elements from given start location.
 *
 * Arguments and results are 1-based.
 * Computation is zero-based.
 */
function getCoord(arr: any[][], startLine: number, startColumn: number, length: number) {
  let remaining = length,
    line   = startLine - 1,
    column = startColumn - 1;

  while (remaining > 0) {
    while (column < arr[line].length && remaining > 0) {
      column    += 1;
      remaining -= 1;
    }
    if (column === arr[line].length) {
      line      += 1;
      column    =  0;
      remaining -= 1; // the newline character
    }
  }
  return {line: line + 1, column: column + 1};
}

function annotateArray(arr: any[][], sourceId: string, sections: TaggedSourceCoordinate[], methods: Method[]) {
  for (let s of sections) {
    let start = ensureItIsAnnotation(arr, s.startLine, s.startColumn),
        coord = getCoord(arr, s.startLine, s.startColumn, s.charLength),
          end = ensureItIsAnnotation(arr, coord.line, coord.column),
    sectionId = getSectionId(sourceId, s);

    start.before.push(new Begin(s, sectionId));
    end.before.push(new End(s, s.charLength));
  }

  // adding method definitions
  for (let meth of methods) {
    for (let i in meth.definition) {
      let defPart = meth.definition[i],
        start = ensureItIsAnnotation(arr, defPart.startLine, defPart.startColumn),
        coord = getCoord(arr, defPart.startLine, defPart.startColumn, defPart.charLength),
        end   = ensureItIsAnnotation(arr, coord.line, coord.column);

      start.before.push(new BeginMethodDef(meth, sourceId, parseInt(i), defPart));
      end.before.push(new End(meth.sourceSection, defPart.charLength));
    }
  }
}

function enableEventualSendClicks(fileNode) {
  const sendOperator = fileNode.find(".EventualMessageSend");
  sendOperator.attr({
    "data-toggle"    : "popover",
    "data-trigger"   : "click hover",
    "title"          : "Breakpoints",
    "data-html"      : "true",
    "data-placement" : "auto top"
  });

  sendOperator.attr("data-content", function() {
    let content = nodeFromTemplate("actor-bp-menu");
    // capture the source section id, and store it on the buttons
    $(content).find("button").attr("data-ss-id", this.id);
    return $(content).html();
  });
  sendOperator.popover();

  $(document).on("click", ".bp-rcv-msg", function (e) {
    e.stopImmediatePropagation();
    ctrl.onToggleSendBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "MessageReceiverBreakpoint");
  });

  $(document).on("click", ".bp-send-msg", function (e) {
    e.stopImmediatePropagation();
    ctrl.onToggleSendBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "MessageSenderBreakpoint");
  });

  $(document).on("click", ".bp-rcv-prom", function (e) {
    e.stopImmediatePropagation();
    ctrl.onTogglePromiseBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "PromiseResolutionBreakpoint");
  });

  $(document).on("click", ".bp-send-prom", function (e) {
    e.stopImmediatePropagation();
    ctrl.onTogglePromiseBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "PromiseResolverBreakpoint");
  });
}

function enableChannelClicks(fileNode) {
  constructChannelBpMenu(fileNode, ".ChannelRead",  "channel-read-bp-menu");
  constructChannelBpMenu(fileNode, ".ChannelWrite", "channel-write-bp-menu");
}

function constructChannelBpMenu(fileNode, tag: string, tpl: string) {
  const sendOperator = fileNode.find(tag);
  sendOperator.attr({
    "data-toggle"    : "popover",
    "data-trigger"   : "click hover",
    "title"          : "Breakpoints",
    "data-html"      : "true",
    "data-placement" : "auto top"
  });

  sendOperator.attr("data-content", function() {
    let content = nodeFromTemplate(tpl);
    // capture the source section id, and store it on the buttons
    $(content).find("button").attr("data-ss-id", this.id);
    return $(content).html();
  });
  sendOperator.popover();

  $(document).on("click", ".bp-before", function (e) {
    e.stopImmediatePropagation();
    ctrl.onToggleSendBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "MessageSenderBreakpoint");
  });

  $(document).on("click", ".bp-after", function (e) {
    e.stopImmediatePropagation();
    ctrl.onToggleSendBreakpoint(e.currentTarget.attributes["data-ss-id"].value, "ChannelOppositeBreakpoint");
  });
}

function enableMethodBreakpointHover(fileNode) {
  let methDecls = fileNode.find(".MethodDeclaration");
  methDecls.attr({
    "data-toggle"   : "popover",
    "data-trigger"  : "click hover",
    "title"         : "Breakpoints",
    "animation"     : "false",
    "data-html"     : "true",
    "data-placement": "auto top" });

  methDecls.attr("data-content", function () {
    let idObj = methodDeclIdToObj(this.id);
    let content = nodeFromTemplate("method-breakpoints");
    $(content).find("button").attr("data-ss-id", getSectionId(idObj.sourceId, idObj));
    return $(content).html();
  });

  methDecls.popover();

  $(document).on("click", ".bp-async-rcv", function (e) {
    e.stopImmediatePropagation();
    ctrl.onToggleMethodAsyncRcvBreakpoint(e.currentTarget.attributes["data-ss-id"].value);
  });
}

function showSource(source: Source, sourceId: string) {
  let tabListEntry = <Element> document.getElementById("" + sourceId),
    aElem = document.getElementById("a" + sourceId);
  if (tabListEntry) {
    if (aElem.innerText !== source.name) {
      $(tabListEntry).remove();
      $(aElem).remove();
      tabListEntry = null;
      aElem = null;
    } else {
      return; // source is already there, so, I think, we don't need to update it
    }
  }

  const annotationArray = sourceToArray(source.sourceText);
  annotateArray(annotationArray, sourceId, source.sections, source.methods);

  tabListEntry = nodeFromTemplate("tab-list-entry");

  if (aElem === null) {
    // create the tab "header/handle"
    const elem = $(tabListEntry).find("a");
    elem.attr("href", "#" + sourceId);
    elem.attr("id", "a" + sourceId);
    elem.text(source.name);
    aElem = elem.get(0);
    $("#tabs").append(tabListEntry);
  }

  // create tab pane
  const newFileElement = nodeFromTemplate("file");
  newFileElement.setAttribute("id", "" + sourceId);
  newFileElement.getElementsByClassName("line-numbers")[0].innerHTML = createLineNumbers(annotationArray.length);
  const fileNode = newFileElement.getElementsByClassName("source-file")[0];
  fileNode.innerHTML = arrayToString(annotationArray);

  // enable clicking on EventualSendNodes
  enableEventualSendClicks($(fileNode));
  enableChannelClicks($(fileNode));
  enableMethodBreakpointHover($(fileNode));

  const files = document.getElementById("files");
  files.appendChild(newFileElement);
}

function showFrame(frame: StackFrame, i: number, list: Element) {
  let stackEntry = frame.name;
  if (frame.line) {
    stackEntry += ":" + frame.line + ":" + frame.column;
  }
  const entry = nodeFromTemplate("stack-frame-tpl");
  entry.setAttribute("id", "frame-" + i);

  const tds = $(entry).find("td");
  tds[0].innerHTML = stackEntry;
  list.appendChild(entry);
}

/**
 * The HTML View, which realizes all access to the DOM for displaying
 * data and reacting to events.
 */
export class View {
  private currentSectionId?: string;
  private currentDomNode?;

  constructor() {
    this.currentSectionId = null;
    this.currentDomNode   = null;
  }

  onConnect() {
    $("#dbg-connect-btn").html("Connected");
  }

  onClose() {
    $("#dbg-connect-btn").html("Reconnect");
  }

  displaySources(sources: IdMap<Source>) {
    let sId; // keep last id to show tab
    for (sId in sources) {
      showSource(sources[sId], sId);
    }
    $('.nav-tabs a[href="#' + sId + '"]').tab("show");
  }

  displayUpdatedSourceSections(data, getSourceAndMethods) {
    // update the source sections for the sourceId

    const pane = document.getElementById(data.sourceId);
    const sourceFile = $(pane).find(".source-file");

    // remove all spans
    sourceFile.find("span").replaceWith($(".html"));

    // apply new spans
    const result = getSourceAndMethods(data.sourceId),
      source   = result[0],
      methods  = result[1];

    const annotationArray = sourceToArray(source.sourceText);
    annotateArray(annotationArray, source.id, data.sections, methods);
    sourceFile.html(arrayToString(annotationArray));

    // enable clicking on EventualSendNodes
    enableEventualSendClicks(sourceFile);
    enableChannelClicks(sourceFile);
    enableMethodBreakpointHover(sourceFile);
  }

  private getScopeId(varRef: number) {
    return "scope:" + varRef;
  }

  public displayScope(s: Scope) {
    const list = document.getElementById("frame-state");
    const entry = nodeFromTemplate("scope-head-tpl");
    entry.id = this.getScopeId(s.variablesReference);
    let t = $(entry).find("th");
    t.html(s.name);
    list.appendChild(entry);
  }

  private createVarElement(name: string, value: string, varRef: number): Element {
    const entry = nodeFromTemplate("frame-state-tpl");
    entry.id = this.getScopeId(varRef);
    let t = $(entry).find("th");
    t.html(name);
    t = $(entry).find("td");
    t.html(value);
    return entry;
  }

  public displayVariables(varRef: number, vars: Variable[]) {
    const scopeEntry = document.getElementById(this.getScopeId(varRef));

    for (const v of vars) {
      scopeEntry.insertAdjacentElement(
        "afterend",
        this.createVarElement(v.name, v.value, v.variablesReference));
    }
  }

  displayStackTrace(data: StackTraceResponse, sourceId: string) {
    let list = document.getElementById("stack-frames");
    while (list.lastChild) {
      list.removeChild(list.lastChild);
    }

    for (let i = 0; i < data.stackFrames.length; i++) {
      showFrame(data.stackFrames[i], i, list);
    }

    list = document.getElementById("frame-state");
    while (list.lastChild) {
      list.removeChild(list.lastChild);
    }

    const line = data.stackFrames[0].line,
      column = data.stackFrames[0].column,
      length = data.stackFrames[0].length;

    // highlight current node
    let ssId = getSectionId(sourceId,
                 {startLine: line, startColumn: column, charLength: length});
    let ss = document.getElementById(ssId);
    $(ss).addClass("DbgCurrentNode");

    this.currentDomNode   = ss;
    this.currentSectionId = ssId;
    this.showSourceById(sourceId);

    // scroll to the statement
    $("html, body").animate({
      scrollTop: $(ss).offset().top
    }, 300);
  }

  showSourceById(sourceId: string) {
    if (this.getActiveSourceId() !== sourceId) {
      $(document.getElementById("a" + sourceId)).tab("show");
    }
  }

  getActiveSourceId(): string {
    return $(".tab-pane.active").attr("id");
  }

  ensureBreakpointListEntry(breakpoint: Breakpoint) {
    if (breakpoint.checkbox !== null) {
      return;
    }

    let bpId = breakpoint.getId();
    let entry = nodeFromTemplate("breakpoint-tpl");
    entry.setAttribute("id", bpId);

    let tds = $(entry).find("td");
    tds[0].innerHTML = breakpoint.source.name;
    tds[1].innerHTML = breakpoint.getId();

    breakpoint.checkbox = $(entry).find("input");
    breakpoint.checkbox.attr("id", bpId + "chk");

    const list = document.getElementById("breakpoint-list");
    list.appendChild(entry);
  }

  updateBreakpoint(breakpoint: Breakpoint, highlightElem: JQuery,
      highlightClass: string) {
    this.ensureBreakpointListEntry(breakpoint);
    const enabled = breakpoint.isEnabled();

    breakpoint.checkbox.prop("checked", enabled);
    if (enabled) {
      highlightElem.addClass(highlightClass);
    } else {
      highlightElem.removeClass(highlightClass);
    }
  }

  updateLineBreakpoint(bp: LineBreakpoint) {
    const lineNumSpan = $(bp.lineNumSpan);
    this.updateBreakpoint(bp, lineNumSpan, "breakpoint-active");
  }

  updateSendBreakpoint(bp: MessageBreakpoint) {
    const bpSpan = document.getElementById(bp.sectionId);
    this.updateBreakpoint(bp, $(bpSpan), "send-breakpoint-active");
  }

  updateAsyncMethodRcvBreakpoint(bp: MessageBreakpoint) {
    let i = 0,
      elem = null;
    while (elem = document.getElementById(
        methodDeclIdToString(bp.sectionId, i))) {
      this.updateBreakpoint(bp, $(elem), "send-breakpoint-active");
      i += 1;
    }
  }

  updatePromiseBreakpoint(bp: MessageBreakpoint) {
    const bpSpan = document.getElementById(bp.sectionId);
    this.updateBreakpoint(bp, $(bpSpan), "promise-breakpoint-active");
  }

  findActivityDebuggerButtons(activityId: number) {
    const id = this.getActivityId(activityId);
    const act = $("#" + id);
    return {
      resume:   act.find(".act-resume"),
      pause:    act.find(".act-pause"),
      stepInto: act.find(".act-step-into"),
      stepOver: act.find(".act-step-over"),
      return:   act.find(".act-return")
    };
  }

  switchActivityDebuggerToSuspendedState(activityId: number) {
    const btns = this.findActivityDebuggerButtons(activityId);

    btns.resume.removeClass("disabled");
    btns.pause.addClass("disabled");

    btns.stepInto.removeClass("disabled");
    btns.stepOver.removeClass("disabled");
    btns.return.removeClass("disabled");
  }

  switchActivityDebuggerToResumedState(activityId: number) {
    const btns = this.findActivityDebuggerButtons(activityId);

    btns.resume.addClass("disabled");
    btns.pause.removeClass("disabled");

    btns.stepInto.addClass("disabled");
    btns.stepOver.addClass("disabled");
    btns.return.addClass("disabled");
  }

  onContinueExecution(activityId: number) {
    this.switchActivityDebuggerToResumedState(activityId);
  }
}
