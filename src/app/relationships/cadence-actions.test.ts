import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ saveRelationshipCadence: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/relationship-store", () => ({ saveRelationshipCadence: mocks.saveRelationshipCadence }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { updateContactCadence } from "./cadence-actions";

describe("contact cadence action", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());
  it("validates and saves an optional user choice and refreshes Home", async () => {
    const form = new FormData();
    form.set("contactCadence", "180");
    await updateContactCadence("fictional-person", form);
    expect(mocks.saveRelationshipCadence).toHaveBeenCalledWith("fictional-person", 180);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    form.set("contactCadence", "suggested");
    await updateContactCadence("fictional-person", form);
    expect(mocks.saveRelationshipCadence).toHaveBeenLastCalledWith("fictional-person", undefined);
    form.set("contactCadence", "0");
    await updateContactCadence("fictional-person", form);
    expect(mocks.saveRelationshipCadence).toHaveBeenLastCalledWith("fictional-person", 0);
    form.set("contactCadence", "17");
    await expect(updateContactCadence("fictional-person", form)).rejects.toThrow("supported contact cadence");
    expect(mocks.saveRelationshipCadence).toHaveBeenCalledTimes(3);
  });
  it("refuses an unconfigured production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RA_DATASET_MODE", "fictional");
    const form = new FormData();
    form.set("contactCadence", "180");
    await expect(updateContactCadence("fictional-person", form)).rejects.toThrow();
    expect(mocks.saveRelationshipCadence).not.toHaveBeenCalled();
  });
});
