// Renderer: setup screen, compact/expanded card rendering, and the local
// countdown tick (no network involved — agenda data is pushed from main).
"use strict";

(function () {
  const { describeCountdown, formatTimeRange } = window.CalendarWidgetTime;
  const { selectActiveMeetings, selectUpNext } = window.CalendarWidgetFilter;

  const els = {
    setup: document.getElementById("setup"),
    widget: document.getElementById("widget"),
    clientId: document.getElementById("clientId"),
    clientSecret: document.getElementById("clientSecret"),
    accountEmail: document.getElementById("accountEmail"),
    connectBtn: document.getElementById("connectBtn"),
    setupError: document.getElementById("setupError"),
    setupQuitBtn: document.getElementById("setupQuitBtn"),
    staleBadge: document.getElementById("staleBadge"),
    refreshBtn: document.getElementById("refreshBtn"),
    expandBtn: document.getElementById("expandBtn"),
    meetingTitle: document.getElementById("meetingTitle"),
    meetingTimeRange: document.getElementById("meetingTimeRange"),
    countdown: document.getElementById("countdown"),
    countdownText: document.getElementById("countdownText"),
    joinBtn: document.getElementById("joinBtn"),
    stackedMeetings: document.getElementById("stackedMeetings"),
    moreMeetings: document.getElementById("moreMeetings"),
    upNext: document.getElementById("upNext"),
    upNextTime: document.getElementById("upNextTime"),
    upNextTitle: document.getElementById("upNextTitle"),
    agendaList: document.getElementById("agendaList"),
    todayList: document.getElementById("todayList"),
    tomorrowList: document.getElementById("tomorrowList"),
  };

  const PROVIDER_COLOR_VARS = {
    zoom: "--provider-zoom",
    meet: "--provider-meet",
    teams: "--provider-teams",
    webex: "--provider-webex",
    video: "--provider-video",
  };

  let latestAgenda = null; // last payload from 'agenda:update'
  let expanded = false;
  let refreshRequestedForEndedMeeting = false;
  // Concurrent meetings shown as slim rows under the main one; past this many
  // the rest collapse into a "+N more" note. Matches MAX_STACKED_ROWS in main.
  const MAX_STACKED_ROWS = 2;

  let primaryMeeting = null; // the meeting the main card (and its Join) is about
  let stackedSignature = ""; // what the stacked rows currently show
  let reportedExtras = { stackedRows: 0, noteLines: 0 }; // last sent to main
  let reconnecting = false; // consent screen open in the browser
  let reconnectError = null; // last failed reconnect, shown on the badge's tooltip

  init();

  async function init() {
    els.connectBtn.addEventListener("click", onConnectClick);
    els.setupQuitBtn.addEventListener("click", () => window.close());
    for (const input of [els.clientId, els.clientSecret, els.accountEmail]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") onConnectClick();
      });
    }
    els.refreshBtn.addEventListener("click", onRefreshClick);
    els.staleBadge.addEventListener("click", onStaleBadgeClick);
    els.expandBtn.addEventListener("click", onExpandClick);
    els.joinBtn.addEventListener("click", onJoinClick);

    window.calendarWidget.onAgendaUpdate((payload) => {
      latestAgenda = payload;
      refreshRequestedForEndedMeeting = false;
      // Data came through, so whatever went wrong last reconnect is moot.
      if (!payload.meta.stale) reconnectError = null;
      render();
    });

    window.calendarWidget.onExpandedChanged((next) => {
      setExpanded(next);
    });

    window.calendarWidget.onSignedOut(() => {
      latestAgenda = null;
      showSetup();
    });

    const { signedIn, expanded: initialExpanded } = await window.calendarWidget.getAuthStatus();
    if (signedIn) {
      showWidget();
      // Catches up on whatever main already computed, in case the push that
      // fired at startup arrived before this listener was registered above.
      // Must happen before setExpanded(), which renders the agenda lists.
      const current = await window.calendarWidget.getAgenda();
      if (current) latestAgenda = current;
      setExpanded(Boolean(initialExpanded));
    } else {
      showSetup();
    }

    tickLoop();
  }

  function showSetup() {
    els.widget.classList.add("hidden");
    els.setup.classList.remove("hidden");
    els.clientId.focus();
  }

  function showWidget() {
    els.setup.classList.add("hidden");
    els.widget.classList.remove("hidden");
  }

  async function onConnectClick() {
    const clientId = els.clientId.value.trim();
    const clientSecret = els.clientSecret.value.trim();
    const accountEmail = els.accountEmail.value.trim();
    els.setupError.classList.add("hidden");

    if (!clientId || !clientSecret) {
      els.setupError.textContent = "Fill in both the Client ID and Client Secret.";
      els.setupError.classList.remove("hidden");
      return;
    }

    els.connectBtn.disabled = true;
    els.connectBtn.textContent = "Waiting for authorization in the browser…";

    const result = await window.calendarWidget.startAuth(clientId, clientSecret, accountEmail);

    els.connectBtn.disabled = false;
    els.connectBtn.textContent = "Connect with Google";

    if (result.ok) {
      showWidget();
    } else {
      els.setupError.textContent = result.error || "Couldn't connect.";
      els.setupError.classList.remove("hidden");
    }
  }

  /**
   * The "outdated" badge doubles as the reconnect button: a refresh token that
   * Google expired or revoked can only be replaced by walking the consent
   * screen again, which main does with the credentials already on file — same
   * client, same account, nothing to retype.
   */
  async function onStaleBadgeClick() {
    if (reconnecting) return;
    reconnecting = true;
    reconnectError = null;
    render();

    const result = await window.calendarWidget.reconnectAuth();

    reconnecting = false;
    if (result.ok) {
      // main already kicked off a poll; its payload clears the badge.
      return;
    }
    if (result.needsSetup) {
      showSetup();
      els.setupError.textContent = result.error || "Connect again.";
      els.setupError.classList.remove("hidden");
      return;
    }
    reconnectError = result.error || "Couldn't reconnect.";
    render();
  }

  function onRefreshClick() {
    els.refreshBtn.classList.remove("spinning");
    // restart the CSS animation
    void els.refreshBtn.offsetWidth;
    els.refreshBtn.classList.add("spinning");
    window.calendarWidget.refreshAgenda();
  }

  async function onExpandClick() {
    const { expanded: next } = await window.calendarWidget.toggleExpand(!expanded);
    setExpanded(next);
  }

  function setExpanded(next) {
    expanded = next;
    els.agendaList.classList.toggle("hidden", !expanded);
    els.expandBtn.classList.toggle("expanded", expanded);
    els.expandBtn.title = expanded ? "Collapse" : "Expand";
    if (expanded) renderAgendaLists();
  }

  function onJoinClick() {
    if (primaryMeeting && primaryMeeting.meetingLink) {
      window.calendarWidget.openLink(primaryMeeting.meetingLink.url);
    }
  }

  function openEventInCalendar(event) {
    if (event.htmlLink) window.calendarWidget.openLink(event.htmlLink);
  }

  function tickLoop() {
    render();
    const now = new Date();
    const msToNextTick = 15000 - (now.getTime() % 15000);
    setTimeout(tickLoop, msToNextTick);
  }

  function render() {
    if (!latestAgenda) return;

    const { upcoming, meta } = latestAgenda;
    const now = Date.now();
    const active = selectActiveMeetings(upcoming, now);
    primaryMeeting = active[0] || null;

    renderStaleBadge(meta);

    if (!primaryMeeting) {
      const noConnectionEver = meta.error && !meta.fetchedAt;
      els.meetingTitle.textContent = noConnectionEver ? "Couldn't connect" : "Nothing scheduled";
      els.meetingTimeRange.textContent = noConnectionEver
        ? "Check your connection or credentials"
        : "No meetings until tomorrow";
      els.countdownText.textContent = "";
      els.countdown.className = "countdown";
      els.joinBtn.classList.add("hidden");
      renderExtras([], null, now);

      // Everything main sent has ended since — ask for a fresh window.
      if (upcoming.length > 0 && !refreshRequestedForEndedMeeting) {
        refreshRequestedForEndedMeeting = true;
        window.calendarWidget.refreshAgenda();
      }

      if (expanded) renderAgendaLists();
      return;
    }

    els.meetingTitle.textContent = primaryMeeting.title;
    els.meetingTimeRange.textContent = formatTimeRange(
      primaryMeeting.startMs,
      primaryMeeting.endMs,
      meta.timeZone
    );

    const countdown = describeCountdown(primaryMeeting, now);
    els.countdownText.textContent = countdown.label;
    els.countdownText.classList.toggle("countdown-text-long", countdown.state === "in-progress");
    els.countdown.className = `countdown ${urgencyClass(countdown, primaryMeeting, now)}`;

    if (primaryMeeting.meetingLink) {
      els.joinBtn.classList.remove("hidden");
      els.joinBtn.textContent = `Join (${primaryMeeting.meetingLink.label})`;
    } else {
      els.joinBtn.classList.add("hidden");
    }

    renderExtras(active.slice(1), selectUpNext(upcoming, active, now), now);

    if (expanded) renderAgendaLists();
  }

  /**
   * Everything below the main meeting: the other concurrent meetings (a slim
   * row each, then "+N more") and the "Up next …" note. Tells main how many
   * rows that came to, since main owns the compact window height — the card
   * has no slack for extra rows on its own.
   */
  function renderExtras(others, upNext, now) {
    const stacked = others.slice(0, MAX_STACKED_ROWS);
    const hiddenCount = others.length - stacked.length;

    renderStackedRows(stacked, now);

    els.moreMeetings.textContent = `+${hiddenCount} more`;
    els.moreMeetings.classList.toggle("hidden", hiddenCount === 0);

    if (upNext) {
      els.upNextTime.textContent = formatTime(upNext.startMs);
      els.upNextTitle.textContent = upNext.title;
    }
    els.upNext.classList.toggle("hidden", !upNext);

    const extras = {
      stackedRows: stacked.length,
      noteLines: (hiddenCount > 0 ? 1 : 0) + (upNext ? 1 : 0),
    };
    if (
      extras.stackedRows === reportedExtras.stackedRows &&
      extras.noteLines === reportedExtras.noteLines
    ) {
      return;
    }
    reportedExtras = extras;
    window.calendarWidget.setCompactExtras(extras);
  }

  function renderStackedRows(meetings, now) {
    // Rebuilt only when something visible changes, so the 15s tick doesn't
    // yank a Join button out from under the cursor.
    const signature = JSON.stringify(
      meetings.map((m) => [m.id, m.title, m.endMs, m.startMs <= now, m.meetingLink])
    );
    if (signature === stackedSignature) return;
    stackedSignature = signature;

    els.stackedMeetings.innerHTML = "";
    els.stackedMeetings.classList.toggle("hidden", meetings.length === 0);

    for (const meeting of meetings) {
      const row = document.createElement("div");
      row.className = "stacked-row";
      row.classList.toggle("live", meeting.startMs <= now);

      const dot = document.createElement("span");
      dot.className = "urgency-dot";

      const title = document.createElement("span");
      title.className = "stacked-title";
      title.textContent = meeting.title;
      title.title = meeting.title;
      title.addEventListener("click", () => openEventInCalendar(meeting));

      const time = document.createElement("span");
      time.className = "stacked-time";
      time.textContent = `until ${formatTime(meeting.endMs)}`;

      row.append(dot, title, time);

      if (meeting.meetingLink) {
        const join = document.createElement("button");
        join.className = "join-btn no-drag";
        // Just "Join": the provider label would eat the room the title needs.
        join.textContent = "Join";
        join.title = `Join (${meeting.meetingLink.label})`;
        join.addEventListener("click", () =>
          window.calendarWidget.openLink(meeting.meetingLink.url)
        );
        row.appendChild(join);
      }

      els.stackedMeetings.appendChild(row);
    }
  }

  function formatTime(ms) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: latestAgenda.meta.timeZone,
    }).format(new Date(ms));
  }

  function urgencyClass(countdown, meeting, now) {
    if (countdown.state === "in-progress" || countdown.state === "starting") {
      return "urgency-critical";
    }
    if (countdown.state === "upcoming" && countdown.minutesUntil <= 2) return "urgency-critical";
    if (countdown.state === "upcoming" && countdown.minutesUntil <= 15) return "urgency-soon";
    return "";
  }

  function renderStaleBadge(meta) {
    if (reconnecting) {
      els.staleBadge.textContent = "reconnecting…";
      els.staleBadge.title = "Finish the consent screen in your browser.";
      els.staleBadge.disabled = true;
      els.staleBadge.classList.remove("hidden");
      return;
    }

    els.staleBadge.textContent = "outdated";
    els.staleBadge.disabled = false;

    if (reconnectError) {
      els.staleBadge.title = `Couldn't reconnect: ${reconnectError} — click to try again`;
      els.staleBadge.classList.remove("hidden");
      return;
    }

    if (!meta.stale) {
      els.staleBadge.classList.add("hidden");
      return;
    }

    if (meta.fetchedAt) {
      const minutesAgo = Math.max(0, Math.round((Date.now() - meta.fetchedAt) / 60000));
      const status = meta.error
        ? `${meta.error} — last updated ${minutesAgo} min ago`
        : `Last updated ${minutesAgo} min ago`;
      els.staleBadge.title = `${status}
Click to reconnect with Google.`;
    } else {
      // Nothing cached to fall back on — usually a token Google won't renew.
      els.staleBadge.title = `${meta.error || "No data yet"}
Click to reconnect with Google.`;
    }
    els.staleBadge.classList.remove("hidden");
  }

  function renderAgendaLists() {
    if (!latestAgenda) return;
    fillList(els.todayList, latestAgenda.today);
    fillList(els.tomorrowList, latestAgenda.tomorrow);
  }

  function fillList(listEl, events) {
    listEl.innerHTML = "";

    if (!events || events.length === 0) {
      const empty = document.createElement("li");
      empty.className = "agenda-empty";
      empty.textContent = "No events";
      listEl.appendChild(empty);
      return;
    }

    for (const event of events) {
      const row = document.createElement("li");
      row.className = "agenda-row";

      const dot = document.createElement("span");
      dot.className = "provider-dot";
      if (event.meetingLink) {
        const varName = PROVIDER_COLOR_VARS[event.meetingLink.id] || PROVIDER_COLOR_VARS.video;
        dot.style.background = `var(${varName})`;
      }

      const time = document.createElement("span");
      time.className = "row-time";
      time.textContent = formatTime(event.startMs);

      const title = document.createElement("span");
      title.className = "row-title";
      title.textContent = event.title;

      row.append(dot, time, title);
      row.addEventListener("click", () => openEventInCalendar(event));
      listEl.appendChild(row);
    }
  }
})();
