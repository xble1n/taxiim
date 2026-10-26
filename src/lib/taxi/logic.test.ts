import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHIFT_LOCK_HOURS,
  shiftLockedUntil,
  MAX_ADMINS,
  MAX_DRIVERS,
  actionAllowedFor,
  assessGps,
  canCreateAccount,
  costPerKm,
  fuelTotal,
  litersPer100,
  summarizeDay,
  unusualFuel,
  haversineMeters,
  gpsQuality,
  nextDriverCode,
  nextStatus,
  quoteEuros,
  sanitizeChat,
  validatePassword,
  validatePrice,
} from "./logic.ts";

describe("accounts", () => {
  it("caps administrators at the configured limit and drivers at 50", () => {
    assert.equal(MAX_ADMINS, 1);
    assert.equal(canCreateAccount("ADMIN", 0), true);
    assert.equal(canCreateAccount("ADMIN", MAX_ADMINS), false);
    assert.equal(canCreateAccount("DRIVER", MAX_DRIVERS - 1), true);
    assert.equal(canCreateAccount("DRIVER", MAX_DRIVERS), false);
  });

  it("rejects weak passwords", () => {
    assert.equal(validatePassword("short1").success, false);
    assert.equal(validatePassword("longpassword").success, false);
    assert.equal(validatePassword("Fleet-demo-26").success, true);
  });

  it("assigns the next driver code", () => {
    assert.equal(nextDriverCode(["D-01", "D-02"]), "D-03");
  });
});

describe("fleet math", () => {
  it("computes consumption and cost per kilometre", () => {
    assert.equal(fuelTotal(35.4, 1.45), 51.33);
    assert.equal(litersPer100(35.4, 420), 8.43);
    assert.equal(litersPer100(10, 0), null);
    assert.equal(costPerKm(80, 400), 0.2);
    assert.equal(unusualFuel(13), true);
    assert.equal(unusualFuel(8), false);
  });
});

describe("orders", () => {
  it("follows the dispatch lifecycle", () => {
    assert.equal(nextStatus("PENDING", "dispatch"), "DISPATCHED");
    assert.equal(nextStatus("DISPATCHED", "accept"), "ACCEPTED");
    assert.equal(nextStatus("DISPATCHED", "decline"), "DECLINED");
    assert.equal(nextStatus("ACCEPTED", "enroute"), "ON_THE_WAY");
    assert.equal(nextStatus("ACCEPTED", "arrived"), null);
    assert.equal(nextStatus("ON_THE_WAY", "arrived"), "ARRIVED");
    assert.equal(nextStatus("ARRIVED", "start"), "IN_PROGRESS");
    assert.equal(nextStatus("IN_PROGRESS", "complete"), "COMPLETED");
  });

  it("rejects illegal transitions", () => {
    assert.equal(nextStatus("PENDING", "complete"), null);
    assert.equal(nextStatus("COMPLETED", "cancel"), null);
    assert.equal(nextStatus("IN_PROGRESS", "accept"), null);
    assert.equal(nextStatus("DECLINED", "start"), null);
  });

  it("keeps driver actions off the admin role and the reverse", () => {
    assert.equal(actionAllowedFor("DRIVER", "accept"), true);
    assert.equal(actionAllowedFor("DRIVER", "cancel"), false);
    assert.equal(actionAllowedFor("ADMIN", "cancel"), true);
    assert.equal(actionAllowedFor("ADMIN", "accept"), false);
  });
});

describe("gps", () => {
  it("measures a known geodesic", () => {
    const meters = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    assert.ok(Math.abs(meters - 111195) < 400);
  });

  it("ignores jitter and rejects impossible jumps", () => {
    const prev = { lat: 42.66, lng: 21.16, at: 1_000_000 };
    const jitter = assessGps(prev, {
      lat: 42.66005,
      lng: 21.16005,
      accuracyM: 12,
      speedMps: null,
      at: 1_004_000,
    });
    assert.equal(jitter.accept, true);
    assert.equal(jitter.addedKm, 0);

    const jump = assessGps(prev, {
      lat: 42.8,
      lng: 21.4,
      accuracyM: 8,
      speedMps: null,
      at: 1_003_000,
    });
    assert.equal(jump.accept, false);
    assert.equal(jump.code, "GPS_JUMP");
  });

  it("rejects impossible coordinates and poor accuracy", () => {
    const bad = assessGps(null, {
      lat: 120,
      lng: 10,
      accuracyM: 5,
      speedMps: null,
      at: 1,
    });
    assert.equal(bad.code, "GPS_INVALID");
    const poor = assessGps(null, {
      lat: 42.6,
      lng: 21.1,
      accuracyM: 9000,
      speedMps: null,
      at: 1,
    });
    assert.equal(poor.accept, false);
  });

  it("prefers a sane device speed", () => {
    const d = assessGps(null, {
      lat: 42.66,
      lng: 21.16,
      accuracyM: 10,
      speedMps: 10,
      at: 5_000,
    });
    assert.equal(d.accept, true);
    assert.ok(d.speedKmh != null && Math.abs(d.speedKmh - 36) < 0.1);
  });

  it("marks weak and missing GPS without treating the driver as live", () => {
    assert.equal(gpsQuality({ online: false, error: null, accuracyM: 5, stale: false, hasFix: true }), "off");
    assert.equal(gpsQuality({ online: true, error: null, accuracyM: 8, stale: false, hasFix: true }), "active");
    assert.equal(gpsQuality({ online: true, error: null, accuracyM: 80, stale: false, hasFix: true }), "weak");
    assert.equal(gpsQuality({ online: true, error: "denied", accuracyM: null, stale: false, hasFix: false }), "unavailable");
    assert.equal(gpsQuality({ online: true, error: null, accuracyM: 8, stale: true, hasFix: true }), "unavailable");
  });
});

describe("prices and chat", () => {
  it("quotes and rejects invalid prices", () => {
    assert.equal(quoteEuros(12, 0.8, 0.15, 10, 20), 23);
    assert.equal(quoteEuros(2, 0.1, 0, 1, 1, 8), 8);
    assert.equal(quoteEuros(15, 0, 0, 40, 60, 20), 15);
    assert.equal(validatePrice({ name: "A", basePrice: 1, perKm: 0, perMin: 0 }).success, false);
    assert.equal(validatePrice({ name: "Airport", basePrice: -1, perKm: 0, perMin: 0 }).success, false);
    const ok = validatePrice({ name: "Airport", basePrice: 18, perKm: 0.5, perMin: 0.1 });
    assert.equal(ok.success, true);
  });

  it("strips markup and enforces length", () => {
    const clean = sanitizeChat("  Hello <b>desk</b>  ");
    assert.equal(clean.success && clean.text, "Hello desk");
    assert.equal(sanitizeChat("<img src=x>").success, false);
    assert.equal(sanitizeChat("x".repeat(501)).success, false);
  });
});

describe("summarizeDay", () => {
  const min = 60_000;
  // ~1.1 km north per 0.01 deg latitude
  const drive = Array.from({ length: 11 }, (_, i) => ({ lat: 42.8 + i * 0.001, lng: 20.96, t: i * 15_000, speedKmh: 30 }));

  it("adds up distance and driving time", () => {
    const s = summarizeDay(drive);
    assert.ok(s.km > 1 && s.km < 1.2, `km ${s.km}`);
    assert.ok(s.movingMinutes >= 2 && s.movingMinutes <= 3);
    assert.equal(s.stops.length, 0);
  });

  it("finds a stop of five minutes or more", () => {
    const end = drive[drive.length - 1];
    const parked = Array.from({ length: 8 }, (_, i) => ({ lat: end.lat + 0.0001, lng: end.lng, t: end.t + (i + 1) * min, speedKmh: 0 }));
    const s = summarizeDay([...drive, ...parked]);
    assert.equal(s.stops.length, 1);
    assert.ok(s.stops[0].minutes >= 7);
  });

  it("reports a gap when GPS was off and does not count it as distance", () => {
    const later = { lat: 42.9, lng: 21.0, t: drive[drive.length - 1].t + 40 * min, speedKmh: 0 };
    const s = summarizeDay([...drive, later]);
    assert.equal(s.gaps.length, 1);
    assert.equal(s.gaps[0].minutes, 40);
    assert.ok(s.km < 1.2);
  });

  it("ignores impossible jumps", () => {
    const s = summarizeDay([
      { lat: 42.8, lng: 20.96, t: 0, speedKmh: 0 },
      { lat: 43.8, lng: 20.96, t: 10_000, speedKmh: 0 },
    ]);
    assert.equal(s.km, 0);
  });
});

describe("shift lock", () => {
  const start = Date.parse("2026-10-26T06:00:00Z");
  it("locks for 16 hours from going online", () => {
    assert.equal(SHIFT_LOCK_HOURS, 16);
    assert.equal(shiftLockedUntil(new Date(start).toISOString(), start + 60_000), "2026-10-26T22:00:00.000Z");
    assert.equal(shiftLockedUntil(new Date(start).toISOString(), start + 16 * 3_600_000 - 1), "2026-10-26T22:00:00.000Z");
  });
  it("unlocks after 16 hours and when never online", () => {
    assert.equal(shiftLockedUntil(new Date(start).toISOString(), start + 16 * 3_600_000), null);
    assert.equal(shiftLockedUntil(null, start), null);
    assert.equal(shiftLockedUntil("not a date", start), null);
  });
});
