// src/components/vault/SeriesTable.tsx
"use client";

type Row = { id: string; underlying: string; strike: string; expiry: string };

const sample: Row[] = [
  { id: "0xabc…001", underlying: "GNO", strike: "100", expiry: "1728000000" },
];

export default function SeriesTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-default-200/50">
      <table className="min-w-full table-auto text-sm">
        <thead className="bg-content2 text-default-600">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Series ID</th>
            <th className="px-4 py-3 text-left font-medium">Underlying</th>
            <th className="px-4 py-3 text-left font-medium">Strike (xDAI)</th>
            <th className="px-4 py-3 text-left font-medium">Expiry (unix)</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((r) => (
            <tr key={r.id} className="border-t border-default-200/50">
              <td className="px-4 py-3">{r.id}</td>
              <td className="px-4 py-3">{r.underlying}</td>
              <td className="px-4 py-3">{r.strike}</td>
              <td className="px-4 py-3">{r.expiry}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}