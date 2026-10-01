import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { AccountStatus, LatLng, OrderAction, Role } from "./logic";

function wrap<T>(fn: () => Promise<T>): Promise<T | { success: false; message: string; code: string }> {
  return fn().catch((err: unknown) => {
    console.error("[taxi]", err instanceof Error ? err.message : err);
    return { success: false as const, message: "Something went wrong. Try again.", code: "SERVER_ERROR" };
  });
}

export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { publicConfig } = await import("./handlers.server");
  return publicConfig();
});

export const getSession = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadSession } = await import("./handlers.server");
      return loadSession(context.userId);
    });
  });

export const logOutEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { recordLogout } = await import("./handlers.server");
      return recordLogout(context.userId);
    });
  });

export const getPulse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadPulse } = await import("./handlers.server");
      return loadPulse(context.userId);
    });
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadDashboard } = await import("./handlers.server");
      return loadDashboard(context.userId);
    });
  });

export const getFleet = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadFleet } = await import("./handlers.server");
      return loadFleet(context.userId);
    });
  });

export const getOrders = createServerFn({ method: "POST" })
  .validator((input: { status?: string; driverId?: string; q?: string }) => input ?? {})
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { loadOrders } = await import("./handlers.server");
      return loadOrders(context.userId, data);
    });
  });

export const getRoute = createServerFn({ method: "POST" })
  .validator((input: { from: LatLng; to: LatLng }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { previewRoute } = await import("./handlers.server");
      return previewRoute(context.userId, data.from, data.to);
    });
  });

export const findPlaces = createServerFn({ method: "POST" })
  .validator((input: { q: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { searchPlaces } = await import("./handlers.server");
      return searchPlaces(context.userId, data.q ?? "");
    });
  });

export const createDispatch = createServerFn({ method: "POST" })
  .validator(
    (input: {
      driverId?: string;
      broadcast?: boolean;
      pickupLabel: string;
      pickupLat: number;
      pickupLng: number;
      destLabel: string;
      destLat: number;
      destLng: number;
      notes?: string;
      price?: number | null;
      customerName?: string;
      customerPhone?: string;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { dispatchOrder } = await import("./handlers.server");
      return dispatchOrder(context.userId, data);
    });
  });

export const orderAction = createServerFn({ method: "POST" })
  .validator((input: { orderId: string; action: OrderAction; driverId?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { actOnOrder } = await import("./handlers.server");
      return actOnOrder(context.userId, data);
    });
  });

export const createDirectRide = createServerFn({ method: "POST" })
  .validator(
    (input: {
      pickupLabel: string;
      pickupLat: number;
      pickupLng: number;
      destLabel: string;
      destLat: number;
      destLng: number;
      customerName?: string;
      customerPhone?: string;
      notes?: string;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { createDirectRide: run } = await import("./handlers.server");
      return run(context.userId, data);
    });
  });

export const setOnline = createServerFn({ method: "POST" })
  .validator((input: { online: boolean }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { setPresence } = await import("./handlers.server");
      return setPresence(context.userId, Boolean(data.online));
    });
  });

export const sendLocation = createServerFn({ method: "POST" })
  .validator(
    (input: {
      lat: number;
      lng: number;
      accuracyM?: number | null;
      speedMps?: number | null;
      heading?: number | null;
      altitudeM?: number | null;
      at?: number | null;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { postLocation } = await import("./handlers.server");
      return postLocation(context.userId, data);
    });
  });

export const callDriver = createServerFn({ method: "POST" })
  .validator((input: { driverId: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { ringDriver } = await import("./handlers.server");
      return ringDriver(context.userId, data.driverId);
    });
  });

export const setDriverOffline = createServerFn({ method: "POST" })
  .validator((input: { driverId: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { forceOffline } = await import("./handlers.server");
      return forceOffline(context.userId, data.driverId);
    });
  });

export const getAlerts = createServerFn({ method: "POST" })
  .validator((input: { asId?: string }) => input ?? {})
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { loadAlerts } = await import("./handlers.server");
      return loadAlerts(context.userId, data.asId);
    });
  });

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .validator((input: { alertId: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { ackAlert } = await import("./handlers.server");
      return ackAlert(context.userId, data.alertId);
    });
  });

export const getChat = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadChat } = await import("./handlers.server");
      return loadChat(context.userId);
    });
  });

export const postChat = createServerFn({ method: "POST" })
  .validator((input: { body: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { sendChat } = await import("./handlers.server");
      return sendChat(context.userId, data.body);
    });
  });

export const getPrices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadPrices } = await import("./handlers.server");
      return loadPrices(context.userId);
    });
  });

export const upsertPrice = createServerFn({ method: "POST" })
  .validator(
    (input: {
      id?: string;
      name: string;
      basePrice: number;
      perKm: number;
      perMin: number;
      minFare?: number;
      latitude?: number | null;
      longitude?: number | null;
      enabled: boolean;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { savePrice } = await import("./handlers.server");
      return savePrice(context.userId, data);
    });
  });

export const deletePrice = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { removePrice } = await import("./handlers.server");
      return removePrice(context.userId, data.id);
    });
  });

export const getAccounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadAccounts } = await import("./handlers.server");
      return loadAccounts(context.userId);
    });
  });

export const addAccount = createServerFn({ method: "POST" })
  .validator(
    (input: {
      role: Role;
      name: string;
      email: string;
      phone?: string;
      password: string;
      vehicle?: string;
      plate?: string;
      driverCode?: string;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { createAccount } = await import("./handlers.server");
      return createAccount(context.userId, data);
    });
  });

export const editAccount = createServerFn({ method: "POST" })
  .validator(
    (input: {
      id: string;
      name?: string;
      phone?: string;
      vehicle?: string;
      plate?: string;
      driverCode?: string;
      role?: Role;
      status?: AccountStatus;
      deleted?: boolean;
      password?: string;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { updateAccount } = await import("./handlers.server");
      return updateAccount(context.userId, data);
    });
  });

export const getActivity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadActivity } = await import("./handlers.server");
      return loadActivity(context.userId);
    });
  });

export const getReport = createServerFn({ method: "POST" })
  .validator((input: { from: string; to: string; driverId?: string; status?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { loadReport } = await import("./handlers.server");
      return loadReport(context.userId, data);
    });
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadSettings } = await import("./handlers.server");
      return loadSettings(context.userId);
    });
  });

export const putSettings = createServerFn({ method: "POST" })
  .validator(
    (input: {
      companyName: string;
      staleSeconds: number;
      speedAlertKmh: number;
      baseLabel: string;
      baseLat: number;
      baseLng: number;
      operatorName?: string;
      companyPhone?: string;
      fuelHigh?: number;
      serviceWarnDays?: number;
      startFare?: number;
      perKmRate?: number;
    }) => input,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { saveSettings } = await import("./handlers.server");
      return saveSettings(context.userId, data);
    });
  });

export const getDriverBoard = createServerFn({ method: "POST" })
  .validator((input: { asId?: string }) => input ?? {})
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { loadDriverBoard } = await import("./handlers.server");
      return loadDriverBoard(context.userId, data.asId);
    });
  });

export const getVehicles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadVehicles } = await import("./fleet.server");
      return loadVehicles(context.userId);
    });
  });

export const saveVehicle = createServerFn({ method: "POST" })
  .validator((input: {
    id?: string;
    brand: string;
    model: string;
    year?: number | null;
    plate: string;
    color?: string;
    fuelType: string;
    status: string;
    driverId?: string | null;
    odometerKm?: number | null;
    insuranceExpires?: string | null;
    registrationExpires?: string | null;
    inspectionExpires?: string | null;
    nextServiceOn?: string | null;
    nextServiceKm?: number | null;
    notes?: string;
  }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { saveVehicle: save } = await import("./fleet.server");
      return save(context.userId, data);
    });
  });

export const getFuel = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadFuel } = await import("./fleet.server");
      return loadFuel(context.userId);
    });
  });

export const saveFuel = createServerFn({ method: "POST" })
  .validator((input: {
    vehicleId: string;
    driverId?: string | null;
    filledAt?: string;
    fuelType: string;
    liters: number;
    pricePerLiter: number;
    station?: string;
    odometerKm?: number | null;
    fullTank?: boolean;
    referenceNo?: string;
    notes?: string;
  }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { saveFuel: save } = await import("./fleet.server");
      return save(context.userId, data);
    });
  });

export const getMaintenance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadMaintenance } = await import("./fleet.server");
      return loadMaintenance(context.userId);
    });
  });

export const saveMaintenance = createServerFn({ method: "POST" })
  .validator((input: {
    vehicleId: string;
    servicedOn: string;
    kind: string;
    description: string;
    supplier?: string;
    partsCost: number;
    laborCost: number;
    odometerKm?: number | null;
    nextServiceOn?: string | null;
    nextServiceKm?: number | null;
    referenceNo?: string;
    notes?: string;
  }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    return wrap(async () => {
      const { saveMaintenance: save } = await import("./fleet.server");
      return save(context.userId, data);
    });
  });

export const getFleetCosts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return wrap(async () => {
      const { loadFleetCosts } = await import("./fleet.server");
      return loadFleetCosts(context.userId);
    });
  });

