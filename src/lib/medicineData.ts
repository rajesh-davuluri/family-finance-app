import { prisma } from "@/lib/prisma";
import { medicineStatus, type MedicineStatus, type Pack } from "@/lib/medicines";

// Medicines, server side: each one with its packs, recent doses and status.

const day = (d: Date) => d.toISOString().slice(0, 10);
export const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const HISTORY_DAYS = 90;

export type MedicineView = {
  id: string;
  name: string;
  strength: string | null;
  unit: string;
  forWhom: string | null;
  dailyDose: number | null;
  lowStockAt: number | null;
  notes: string | null;
  archived: boolean;
  packs: Pack[];
  doses: { id: string; takenOn: string; quantity: number; by: string | null; note: string | null }[];
  status: MedicineStatus;
};

export async function ownedMedicine(id: string, householdId: string) {
  const m = await prisma.medicine.findUnique({ where: { id } });
  return m && m.householdId === householdId ? m : null;
}

export async function loadMedicines(householdId: string, today: string, opts: { includeArchived?: boolean } = {}): Promise<MedicineView[]> {
  const since = toDate(today);
  since.setUTCDate(since.getUTCDate() - HISTORY_DAYS);
  const rows = await prisma.medicine.findMany({
    where: { householdId, ...(opts.includeArchived ? {} : { archived: false }) },
    include: {
      // Packs used up or thrown away more than the history window ago are
      // just clutter; everything still in the cupboard is kept.
      stock: { orderBy: [{ expiresOn: "asc" }, { addedOn: "asc" }] },
      doses: { where: { takenOn: { gte: since } }, orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }], include: { byUser: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((m) => {
    const packs: Pack[] = m.stock
      .map((s) => ({
        id: s.id,
        quantity: Number(s.quantity),
        remaining: Number(s.remaining),
        expiresOn: s.expiresOn ? day(s.expiresOn) : null,
        addedOn: day(s.addedOn),
        discardedOn: s.discardedOn ? day(s.discardedOn) : null,
        note: s.note,
      }))
      .filter((p) => p.remaining > 0 || (p.discardedOn ?? p.addedOn) >= day(since));
    const doses = m.doses.map((d) => ({ id: d.id, takenOn: day(d.takenOn), quantity: Number(d.quantity), by: d.byUser?.name ?? null, note: d.note }));
    const dailyDose = m.dailyDose == null ? null : Number(m.dailyDose);
    const lowStockAt = m.lowStockAt == null ? null : Number(m.lowStockAt);
    return {
      id: m.id,
      name: m.name,
      strength: m.strength,
      unit: m.unit,
      forWhom: m.forWhom,
      dailyDose,
      lowStockAt,
      notes: m.notes,
      archived: m.archived,
      packs,
      doses,
      status: medicineStatus({ dailyDose, lowStockAt }, packs, doses, today),
    };
  });
}
