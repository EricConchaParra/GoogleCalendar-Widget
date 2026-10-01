// Which meetings the compact card shows: run with `npm test`.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectActiveMeetings, selectUpNext } = require("../src/shared/filter");

const MIN = 60 * 1000;
const at = (hours, minutes = 0) => Date.UTC(2026, 9, 1, hours, minutes);
const event = (id, startMs, endMs) => ({ id, startMs, endMs });
const ids = (events) => events.map((e) => e.id);

// The double-booked morning that motivated stacking.
const refinementA = event("refinement-a", at(11, 30), at(12, 30));
const refinementB = event("refinement-b", at(11, 30), at(12, 30));
const aqua = event("aqua", at(12, 0), at(12, 30));
const afternoon = event("afternoon", at(15, 0), at(16, 0));
const morning = [refinementA, refinementB, aqua, afternoon];

test("every meeting in progress is active, not just the first", () => {
  assert.deepEqual(ids(selectActiveMeetings(morning, at(11, 58))), [
    "refinement-a",
    "refinement-b",
  ]);
});

test("a meeting that starts mid-way joins the ones already running", () => {
  assert.deepEqual(ids(selectActiveMeetings(morning, at(12, 0))), [
    "refinement-a",
    "refinement-b",
    "aqua",
  ]);
});

test("with nothing live, all meetings tied for the next start are active", () => {
  assert.deepEqual(ids(selectActiveMeetings(morning, at(11, 0))), [
    "refinement-a",
    "refinement-b",
  ]);
});

test("a later meeting is not stacked with the next one", () => {
  assert.deepEqual(ids(selectActiveMeetings(morning, at(13, 0))), ["afternoon"]);
});

test("a meeting drops off at its end time", () => {
  const short = event("short", at(11, 30), at(12, 0));
  const active = selectActiveMeetings([refinementA, short], at(12, 0));
  assert.deepEqual(ids(active), ["refinement-a"]);
});

test("nothing left gives an empty list", () => {
  assert.deepEqual(selectActiveMeetings(morning, at(17, 0)), []);
  assert.deepEqual(selectActiveMeetings([], at(9, 0)), []);
});

test("up next is the meeting that starts while the live ones still run", () => {
  const now = at(11, 58);
  const upNext = selectUpNext(morning, selectActiveMeetings(morning, now), now);
  assert.equal(upNext.id, "aqua");
});

test("up next still covers a strict back-to-back", () => {
  const first = event("first", at(9, 0), at(10, 0));
  const second = event("second", at(10, 0), at(11, 0));
  const now = at(9, 30);
  const upNext = selectUpNext([first, second], selectActiveMeetings([first, second], now), now);
  assert.equal(upNext.id, "second");
});

test("no up next when there is a gap after the live meetings", () => {
  const now = at(12, 10);
  assert.equal(selectUpNext(morning, selectActiveMeetings(morning, now), now), null);
});

test("no up next while nothing is in progress", () => {
  const now = at(11, 0);
  assert.equal(selectUpNext(morning, selectActiveMeetings(morning, now), now), null);
  assert.equal(selectUpNext([], [], now), null);
});

test("up next looks past the longest live meeting, not the first", () => {
  const short = event("short", at(9, 0), at(9, 30));
  const long = event("long", at(9, 0), at(11, 0));
  const later = event("later", at(10, 0), at(10, 30));
  const all = [short, long, later];
  const now = at(9, 0) + MIN;
  assert.equal(selectUpNext(all, selectActiveMeetings(all, now), now).id, "later");
});
