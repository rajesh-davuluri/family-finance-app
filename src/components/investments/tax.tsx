"use client";

// Tax tab: gains by tax year (India: April-March, with the yearly long-term
// exemption; US: calendar year), shares about to turn long-term, and the
// checklist for a US tax resident investing in India.

import { formatDate } from "@/lib/formatDate";
import { INDIA_LTCG_EXEMPTION, fmtMoney, turningLongTerm, type HoldingRow, analyze } from "@/lib/investments";
import { qtyText, tone } from "./shared";

export function TaxTab({ a, checklist }: { a: ReturnType<typeof analyze>; checklist: { title: string; text: string; urgent?: boolean }[] }) {
  const soon = turningLongTerm(a.rows);
  return (
    <div className="space-y-4">
      <TaxPanel a={a} />
      <div className="rounded-lg border bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700">Turning long-term soon</h2>
        <p className="mt-0.5 text-xs text-gray-500">Selling these before the date taxes the gain as short-term (India 20%; US at your income rate).</p>
        {soon.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">Nothing turns long-term in the next 120 days (holdings with approximate dates aren&apos;t counted).</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-1.5 font-medium">Holding</th>
                <th className="py-1.5 text-right font-medium">Shares</th>
                <th className="py-1.5 text-right font-medium">Gain now</th>
                <th className="py-1.5 text-right font-medium">Long-term on</th>
              </tr>
            </thead>
            <tbody>
              {soon.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="py-1.5">{x.name || x.symbol}</td>
                  <td className="py-1.5 text-right tabular-nums">{qtyText(x.quantity)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${tone(x.gain)}`}>{fmtMoney(x.currency, x.gain)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatDate(x.date)} <span className="text-xs text-gray-400">({x.days}d)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {checklist.length > 0 && <Checklist items={checklist} />}
    </div>
  );
}

function TaxPanel({ a }: { a: ReturnType<typeof analyze> }) {
  const india = a.rows.filter((r) => r.country === "IN" && !r.closed && r.value !== null);
  const us = a.rows.filter((r) => r.country === "US" && !r.closed && r.value !== null);
  const sum = (rs: HoldingRow[], k: "longTermGain" | "shortTermGain") => rs.reduce((s, r) => s + (r[k] ?? 0), 0);
  const used = Math.max(0, a.realizedIndia.lt);
  if (!india.length && !us.length && !a.realizedIndia.lt && !a.realizedUs.lt) return null;
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Tax view</h2>
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        {(india.length > 0 || a.realizedIndia.lt !== 0 || a.realizedIndia.st !== 0) && (
          <div>
            <p className="font-medium text-gray-700">India · {a.realizedIndia.label}</p>
            <dl className="mt-1 space-y-0.5 text-gray-600">
              <Row k="Not sold: long-term gain" v={fmtMoney("INR", sum(india, "longTermGain"))} />
              <Row k="Not sold: short-term gain" v={fmtMoney("INR", sum(india, "shortTermGain"))} />
              <Row k="Sold this year: long-term" v={fmtMoney("INR", a.realizedIndia.lt)} />
              <Row k="Sold this year: short-term" v={fmtMoney("INR", a.realizedIndia.st)} />
              <Row
                k="Tax-free long-term left this year"
                v={fmtMoney("INR", Math.max(0, INDIA_LTCG_EXEMPTION - used))}
                note={`of ₹1,25,000`}
              />
            </dl>
          </div>
        )}
        {(us.length > 0 || a.realizedUs.lt !== 0 || a.realizedUs.st !== 0) && (
          <div>
            <p className="font-medium text-gray-700">USA · {a.realizedUs.label}</p>
            <dl className="mt-1 space-y-0.5 text-gray-600">
              <Row k="Not sold: long-term gain" v={fmtMoney("USD", sum(us, "longTermGain"))} />
              <Row k="Not sold: short-term gain" v={fmtMoney("USD", sum(us, "shortTermGain"))} />
              <Row k="Sold this year: long-term" v={fmtMoney("USD", a.realizedUs.lt)} />
              <Row k="Sold this year: short-term" v={fmtMoney("USD", a.realizedUs.st)} />
            </dl>
          </div>
        )}
      </div>
      {a.rows.some((r) => !r.closed && r.approxDates) && (
        <p className="mt-3 text-xs text-gray-400">
          Some buy dates are approximate ({[...new Set(a.rows.filter((r) => !r.closed && r.approxDates).map((r) => r.accountName))].join(", ")}): the long-term/short-term
          split for those holdings may be off until their real dates are added.
        </p>
      )}
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="tabular-nums text-gray-800">
        {v}
        {note && <span className="ml-1 text-xs text-gray-400">{note}</span>}
      </dd>
    </div>
  );
}

export function Checklist({ items }: { items: { title: string; text: string; urgent?: boolean }[] }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Living in the US, investing in India: checklist</h2>
      <p className="mt-0.5 text-xs text-gray-500">If you&apos;re a US tax resident. Worth confirming once with a CPA who handles US–India tax.</p>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((x) => (
          <li key={x.title} className="flex gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.urgent ? "bg-amber-500" : "bg-brand-400"}`} />
            <span>
              <strong className="font-medium text-gray-800">{x.title}.</strong> <span className="text-gray-700">{x.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
