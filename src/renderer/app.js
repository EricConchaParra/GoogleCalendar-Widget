// Renderer: setup screen, compact/expanded card rendering, and the local
// countdown tick (no network involved — agenda data is pushed from main).
"use strict";

(function () {
  const { describeCountdown, formatTimeRange } = window.CalendarWidgetTime;

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
    els.expandBtn.addEventListener("click", onExpandClick);
    els.joinBtn.addEventListener("click", onJoinClick);

    window.calendarWidget.onAgendaUpdate((payload) => {
      latestAgenda = payload;
      refreshRequestedForEndedMeeting = false;
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
    const meeting = latestAgenda && latestAgenda.nextMeeting;
    if (meeting && meeting.meetingLink) {
      window.calendarWidget.openLink(meeting.meetingLink.url);
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

    const { nextMeeting, meta } = latestAgenda;
    const now = Date.now();

    renderStaleBadge(meta);

    if (!nextMeeting) {
      const noConnectionEver = meta.error && !meta.fetchedAt;
      els.meetingTitle.textContent = noConnectionEver ? "Couldn't connect" : "Nothing scheduled";
      els.meetingTimeRange.textContent = noConnectionEver
        ? "Check your connection or credentials"
        : "No meetings until tomorrow";
      els.countdownText.textContent = "";
      els.countdown.className = "countdown";
      els.joinBtn.classList.add("hidden");
      if (expanded) renderAgendaLists();
      return;
    }

    els.meetingTitle.textContent = nextMeeting.title;
    els.meetingTimeRange.textContent = formatTimeRange(
      nextMeeting.startMs,
      nextMeeting.endMs,
      meta.timeZone
    );

    const countdown = describeCountdown(nextMeeting, now);
    els.countdownText.textContent = countdown.label;
    els.countdownText.classList.toggle("countdown-text-long", countdown.state === "in-progress");
    els.countdown.className = `countdown ${urgencyClass(countdown, nextMeeting, now)}`;

    if (nextMeeting.meetingLink) {
      els.joinBtn.classList.remove("hidden");
      els.joinBtn.textContent = `Join (${nextMeeting.meetingLink.label})`;
    } else {
      els.joinBtn.classList.add("hidden");
    }

    if (countdown.state === "ended" && !refreshRequestedForEndedMeeting) {
      refreshRequestedForEndedMeeting = true;
      window.calendarWidget.refreshAgenda();
    }

    if (expanded) renderAgendaLists();
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
    if (meta.stale && meta.fetchedAt) {
      const minutesAgo = Math.max(0, Math.round((Date.now() - meta.fetchedAt) / 60000));
      els.staleBadge.title = meta.error
        ? `${meta.error} — last updated ${minutesAgo} min ago`
        : `Last updated ${minutesAgo} min ago`;
      els.staleBadge.classList.remove("hidden");
    } else {
      els.staleBadge.classList.add("hidden");
    }
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
      time.textContent = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
        timeZone: latestAgenda.meta.timeZone,
      }).format(new Date(event.startMs));

      const title = document.createElement("span");
      title.className = "row-title";
      title.textContent = event.title;

      row.append(dot, time, title);
      row.addEventListener("click", () => openEventInCalendar(event));
      listEl.appendChild(row);
    }
  }
})();
